import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// P4-4b fix 1: AppContext's `appValue`/`syncValue` objects, and the
// `AccessDenied` field inside `appValue`, used to be recreated (new object /
// new component type) on every AppProvider render, forcing all 91 useApp()
// consumers to re-render and forcing React to unmount/remount whatever used
// `<AccessDenied/>` as JSX every time. There is no DOM renderer in this
// project's test harness (no react-dom/test-utils or testing-library
// devDependency -- checked via package.json), so this test asserts against
// the source shape the same way the project's other AppContext-adjacent
// tests do (see tests/actionStability.test.ts): the actual code that would
// make React skip re-render/remount is present, and the old broken pattern
// is gone.

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const appContext = readFrontend('src/AppContext.tsx')

runTest('appValue is memoized with useMemo, not a fresh object literal every render', () => {
  assert.match(
    appContext,
    /const appValue: AppContextValue = useMemo\(\(\) => \(\{/,
    'appValue must be built inside useMemo so unchanged renders reuse the same object reference',
  )
  // Positive control: the old code assigned the object literal directly to
  // `appValue` with no useMemo wrapper at all -- this exact shape must be gone.
  assert.doesNotMatch(
    appContext,
    /const appValue: AppContextValue = \{\s*\n\s*user, login, logout/,
    'the pre-fix unmemoized object literal must not still be present',
  )
})

runTest('syncValue is memoized with useMemo keyed on its three fields', () => {
  assert.match(
    appContext,
    /const syncValue: SyncContextValue = useMemo\(\(\) => \(\{\s*\n\s*syncConnected,\s*\n\s*syncChannel,\s*\n\s*syncServerUnreachable,\s*\n\s*\}\), \[syncConnected, syncChannel, syncServerUnreachable\]\)/,
    'syncValue must be memoized on syncConnected/syncChannel/syncServerUnreachable',
  )
  assert.doesNotMatch(
    appContext,
    /const syncValue: SyncContextValue = \{\s*\n\s*syncConnected,/,
    'the pre-fix unmemoized syncValue literal must not still be present',
  )
})

runTest('appValue useMemo dependency array carries the real fields (not empty, not omitted)', () => {
  const memoStart = appContext.indexOf('const appValue: AppContextValue = useMemo(')
  assert.ok(memoStart >= 0, 'appValue useMemo block not found')
  const memoBlock = appContext.slice(memoStart, memoStart + 3000)
  // The dependency array is the second argument; it must list the same
  // primitives/callbacks used inside the object, not `[]` (which would
  // freeze appValue forever and break every consumer that reads live state)
  // and not be missing entirely.
  assert.match(memoBlock, /\}\), \[\s*\n\s*user, login, logout, persistAuthenticatedUser,/, 'dependency array missing or does not start with the expected fields')
  assert.match(memoBlock, /canWriteToServer,\s*\n\s*storagePersisted,\s*\n\s*\]\)/, 'dependency array must end with canWriteToServer/storagePersisted')
})

runTest('AccessDenied is a stable module-level component, not a new arrow function per render', () => {
  // AccessDeniedConnected must be declared at module scope (outside
  // AppProvider) so its identity never changes across renders.
  assert.match(
    appContext,
    /function AccessDeniedConnected\(\) \{\s*\n\s*const \{ t \} = useApp\(\) as \{ t: \(key: string\) => string \}\s*\n\s*return <AccessDenied t=\{t\} \/>\s*\n\}/,
    'AccessDeniedConnected must be a stable module-level component reading t from context',
  )
  assert.match(
    appContext,
    /AccessDenied: AccessDeniedConnected,/,
    'appValue.AccessDenied must reference the stable AccessDeniedConnected component',
  )
  // Positive control: the old code minted `() => <AccessDenied t={t} />`
  // inline inside the provider's render body -- a brand-new component type
  // every render. That exact assignment must be gone.
  assert.doesNotMatch(
    appContext,
    /AccessDenied: \(\) => <AccessDenied t=\{t\} \/>,/,
    'the pre-fix per-render AccessDenied arrow function must not still be present',
  )
  // AccessDeniedConnected must be declared BEFORE `export function
  // AppProvider` (module scope), not inside it (which would recreate it
  // every render just like the bug it fixes).
  const connectedIndex = appContext.indexOf('function AccessDeniedConnected')
  const providerIndex = appContext.indexOf('export function AppProvider')
  assert.ok(connectedIndex >= 0 && providerIndex >= 0 && connectedIndex < providerIndex, 'AccessDeniedConnected must be declared at module scope, before AppProvider')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All appContextValueStability tests passed')
}
