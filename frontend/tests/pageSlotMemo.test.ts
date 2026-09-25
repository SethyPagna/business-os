// U-sync phase 1, task 3: PageSlot is memoized and every prop it receives
// is stable across the App renders that do not concern it.
//
// Up to MAX_MOUNTED_PAGES pages stay mounted (8 on desktop). Without memo,
// every App render -- a toast, a pending-sync count, the pull-to-refresh
// distance -- re-rendered every kept page. memo() is only worth anything if
// the props are stable too, so this test traces each prop at the render site
// back to its source instead of only checking for the word `memo`.
//
// Red on the old code: PageSlot was a plain function taking `activePageId`
// (the same changing string for every slot).
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const app = read('../src/App.tsx')
const appContext = read('../src/AppContext.tsx')

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

runTest('PageSlot is wrapped in React.memo', () => {
  assert.match(app, /^const PageSlot = memo\(function PageSlot\(\{ accessDenied, isActive, canAccessPage, pageId \}: PageSlotProps\) \{/m)
  assert.doesNotMatch(app, /^function PageSlot\(/m, 'the unmemoized declaration must be gone')
  assert.match(app, /^import \{[^}]*\bmemo\b[^}]*\} from 'react'/m)
})

runTest('PageSlot takes exactly four props, and none is the shared active page id', () => {
  const props = /interface PageSlotProps \{\n([\s\S]*?)\n\}/.exec(app)?.[1] || ''
  const names = props.split('\n').map((line) => line.trim().split(':')[0]).filter(Boolean)
  assert.deepEqual(names, ['accessDenied', 'isActive', 'canAccessPage', 'pageId'])
  const slot = app.slice(app.indexOf('const PageSlot = memo('), app.indexOf('function PublicCatalogFallback'))
  assert.ok(slot.length > 0 && !slot.includes('activePageId'), 'a page id shared by every slot changes all of them on every navigation')
})

runTest('every prop at the render site comes from a stable source', () => {
  const site = /<PageSlot\n([\s\S]*?)\/>/.exec(app)?.[1] || ''
  assert.match(site, /key=\{mountedPage\}/)
  assert.match(site, /accessDenied=\{accessDeniedNode\}/)
  assert.match(site, /isActive=\{mountedPage === page\}/, 'a per-slot boolean: navigation re-renders only the old and new slot')
  assert.match(site, /canAccessPage=\{canAccessPage\}/)
  assert.match(site, /pageId=\{mountedPage\}/)
  assert.equal(site.split('\n').filter((line) => line.trim()).length, 5, 'no extra (possibly unstable) prop')
  // accessDeniedNode: memoized on the stable AccessDenied component.
  assert.match(app, /const accessDeniedNode = useMemo\(\(\) => <AccessDenied \/>, \[AccessDenied\]\)/)
  assert.match(appContext, /AccessDenied: AccessDeniedConnected,/)
  // canAccessPage: a useCallback whose deps all derive from `user` alone
  // (getPermissionTier and can are useCallbacks on the user's authority), so
  // it does not move on toasts, sync windows or navigation.
  const start = appContext.indexOf('const canAccessPage = useCallback((pageId: string) => {')
  const end = appContext.indexOf('\n  }, [', start)
  assert.ok(start > 0 && appContext.slice(end, end + 40).startsWith('\n  }, [user, getPermissionTier, can])'), 'canAccessPage deps must stay [user, getPermissionTier, can]')
  assert.ok(/const getPermissionTier = useCallback\([\s\S]*?\}, \[authority\]\)/.test(appContext), 'getPermissionTier must stay a useCallback on authority')
  assert.ok(/const can = useCallback\([\s\S]*?\}, \[authority\]\)/.test(appContext), 'can must stay a useCallback on authority')
  assert.ok(/const authority = useMemo\(\(\) => effectivePermissions\(user\), \[user\]\)/.test(appContext), 'authority must stay memoized on user')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('All pageSlotMemo tests passed')
