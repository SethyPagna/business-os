// U-sync phase 1, task 4: the toast and the sync window are out of the
// AppContext value.
//
// ~110 files call useApp(). A toast changed `notification` twice (shown,
// cleared) and every sync window changed `syncChannel`; both were fields of
// the one memoized AppContext value, so each change re-rendered every useApp()
// reader, including every kept-mounted page. The toast now lives in
// NotificationContext (read only by the shell's renderer) and the sync window
// only in SyncContext (read through useSync by the 18 page files that need it).
//
// The consumer sweep at the bottom is what keeps this true later: removing a
// field from the value is only safe while nobody destructures it from useApp().
//
// Red on the old code: appValue listed `notify, notification` and
// `syncChannel`, and NotificationContext did not exist.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(frontend, rel), 'utf8').replace(/\r\n/g, '\n')
const appContext = read('src/AppContext.tsx')
const core = read('src/app/AppContextCore.tsx')
const app = read('src/App.tsx')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? error.message : error)
  }
}

function appValueBlock(): string {
  const start = appContext.indexOf('const appValue: AppContextValue = useMemo(')
  const end = appContext.indexOf('\n  ])', start)
  assert.ok(start > 0 && end > start, 'appValue useMemo block not found')
  return appContext.slice(start, end)
}

runTest('the AppContext value (object and deps) carries neither the toast nor the sync window', () => {
  const block = appValueBlock()
  for (const field of ['notification', 'syncChannel', 'syncUpdate']) {
    assert.ok(!new RegExp(`\\b${field}\\b`).test(block), `appValue must not contain ${field}`)
  }
  assert.match(block, /\bnotify,/, 'notify() stays in AppContext')
  assert.match(block, /\bdismissNotification,/)
  assert.match(block, /\bsyncConnected,/, 'the connection flag stays (rarely changes; Sidebar/Settings read it)')
})

runTest('notify and dismissNotification are stable callbacks', () => {
  assert.match(appContext, /const notify = useCallback\(\(message: unknown[\s\S]*?\n {2}\}, \[\]\)/)
  assert.match(appContext, /const dismissNotification = useCallback\(\(\) => \{\n\s*setNotification\(null\)\n\s*\}, \[\]\)/)
})

runTest('the toast is provided through NotificationContext and read only by the shell renderer', () => {
  assert.match(core, /export const NotificationContext = createContext<AppNotification \| null>\(null\)/)
  assert.match(core, /export const useNotification = \(\): AppNotification \| null => useContext\(NotificationContext\)/)
  assert.match(appContext, /<NotificationContext\.Provider value=\{notification\}>/)
  assert.match(app, /function Notification\(\{ onDismiss \}: NotificationProps\) \{[\s\S]{0,400}const notification = useNotification\(\)/)
  assert.match(app, /<Notification onDismiss=\{dismissNotification\} \/>/)
  const appDestructure = /export default function App\(\) \{[\s\S]*?const \{([\s\S]*?)\} = useApp\(\)/.exec(app)?.[1] || ''
  assert.ok(appDestructure.includes('dismissNotification'), 'App destructure not found')
  assert.ok(!/\bnotification\b/.test(appDestructure), 'App itself must not read the toast, or every toast re-renders the shell')
})

runTest('the core context type and fallback no longer declare notification or syncChannel', () => {
  const type = /export type AppContextCoreValue = \{([\s\S]*?)\n\}/.exec(core)?.[1] || ''
  const fallback = /export const FALLBACK_APP_CONTEXT: AppContextCoreValue = \{([\s\S]*?)\n\}/.exec(core)?.[1] || ''
  assert.ok(type && fallback)
  for (const field of ['notification', 'syncChannel']) {
    assert.ok(!new RegExp(`^\\s*${field}:`, 'm').test(type), `AppContextCoreValue must not declare ${field}`)
    assert.ok(!new RegExp(`^\\s*${field}:`, 'm').test(fallback), `FALLBACK_APP_CONTEXT must not carry ${field}`)
  }
})

// Every `const { ... } = useApp(...)` and `useApp() as { ... }` in src. A
// reader of a field the value no longer carries would silently get undefined
// (the casts hide it from the typechecker), so this sweep is the real proof.
runTest('no useApp() reader anywhere in src asks for notification, syncChannel or syncUpdate', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
    }
  }
  walk(path.join(frontend, 'src'))
  let readers = 0
  const offenders: string[] = []
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const patterns = [
      /const \{([^}]*)\} = (?:useApp|useAppHook|useAppContext)\(\)/g,
      /(?:useApp|useAppHook)\(\) as (?:unknown as )?\{([^}]*)\}/g,
    ]
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        readers += 1
        if (/\b(notification|syncChannel|syncUpdate)\b/.test(match[1])) offenders.push(`${path.relative(frontend, file)}: ${match[0].slice(0, 120)}`)
      }
    }
  }
  assert.ok(readers > 80, `the sweep must actually see the useApp() readers (saw ${readers})`)
  assert.deepEqual(offenders, [])
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('All notificationContextSplit tests passed')
