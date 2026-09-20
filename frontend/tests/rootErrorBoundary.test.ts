import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const read = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const source = read('components/shared/RootErrorBoundary.tsx')

function loadBoundary(code = source) {
  const mod: any = { exports: {} }
  const reports: any[] = []
  new Function('require', 'module', 'exports', transformSync(code, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    if (id.includes('clientCrashReport')) return { reportClientCrash: (...args: any[]) => { reports.push(args); return Promise.resolve() } }
    throw new Error(`Unexpected boundary dependency: ${id}`)
  }, mod, mod.exports)
  return { Boundary: mod.exports.default, reports }
}

function errorPanel(Boundary: any) {
  const instance = new Boundary({ surface: 'test-root', children: 'normal application' })
  assert.equal(instance.render(), 'normal application', 'healthy tree passes through unchanged')
  instance.state = Boundary.getDerivedStateFromError(new Error(''))
  const panel = instance.render()
  assert.equal(panel.props.role, 'alert')
  assert.equal(panel.props['data-root-error-boundary'], 'test-root')
  assert.equal(panel.props.style.minHeight, 'calc(100 * var(--app-vh, 1vh))', 'live error panel retains viewport fallback when CSS failed')
  const html = renderToStaticMarkup(panel)
  assert.match(html, /The app could not start/)
  assert.match(html, /កម្មវិធីមិនអាចចាប់ផ្តើមបានទេ/)
  assert.match(html, /Reload/)
  assert.match(html, /Error:/, 'even an empty-message error is not a blank panel')
  return { instance, panel }
}

test('live root error UI is bilingual, viewport-safe without CSS, and reload never touches recovery storage', () => {
  const { Boundary, reports } = loadBoundary()
  const previousWindow = globalThis.window
  let reloads = 0
  const forbidden = () => { throw new Error('Recovery storage must not be accessed') }
  globalThis.window = { location: { reload: () => { reloads++ } }, get localStorage() { return forbidden() }, get sessionStorage() { return forbidden() }, get navigator() { return forbidden() } } as any
  try {
    const { instance, panel } = errorPanel(Boundary)
    assert.equal(reloads, 0, 'render cannot automatically reload')
    const buttons = (node: any): any[] => Array.isArray(node) ? node.flatMap(buttons) : React.isValidElement(node) ? [ ...(node.type === 'button' ? [node] : []), ...buttons((node.props as any).children) ] : []
    const actions = buttons(panel)
    assert.equal(actions.length, 1)
    actions[0].props.onClick()
    assert.equal(reloads, 1, 'only the explicit recovery action reloads')
    const previousError = console.error
    console.error = () => {}
    try { instance.componentDidCatch(new Error('startup failed'), { componentStack: 'provider' }) } finally { console.error = previousError }
    assert.equal(reports.length, 1)
    assert.equal(reports[0][1], 'test-root')
  } finally { globalThis.window = previousWindow }
})

test('negative control rejects a live boundary with its viewport fallback removed', () => {
  const mutant = source.replace("minHeight: 'calc(100 * var(--app-vh, 1vh))'", "minHeight: '0'")
  assert.notEqual(mutant, source, 'negative control actually changes the live component')
  assert.throws(() => errorPanel(loadBoundary(mutant).Boundary), /live error panel retains viewport fallback/)
})

test('root boundary remains outside each provider and startup uses the shared fixed-inset shell', () => {
  assert.match(read('AdminRoot.tsx'), /<RootErrorBoundary[^>]*>\s*<AppProvider/)
  assert.match(read('PublicCatalogRoot.tsx'), /<RootErrorBoundary[^>]*>\s*<PublicCatalogAppProvider/)
  assert.match(read('index.tsx'), /<Suspense fallback=\{<InitialShellFallback/)
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const shell = html.match(/\.business-os-initial-shell\s*\{([^}]+)\}/)?.[1] || ''
  assert.match(shell, /position:\s*fixed/)
  assert.match(shell, /inset:\s*0/)
})
