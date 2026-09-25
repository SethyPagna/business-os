import assert from 'node:assert/strict'
import vm from 'node:vm'
import type { OutputBundle } from 'rollup'
import type { IndexHtmlTransformContext, Plugin } from 'vite'
import config from '../vite.config.ts'

// Invoke the registered build plugin, not a copied selector or source regex.
// These expectations are independent of the config's lists: adding an unwanted
// chunk or dropping required auth/public transport must fail at the DOM boundary.
assert.equal(config.build?.modulePreload, false, 'generic Vite preloads stay disabled')
const plugins = (await Promise.all((config.plugins ?? []) as unknown[])).flat(Infinity) as Plugin[]
const plugin = plugins.find(item => item?.name === 'business-os-route-aware-module-preloads')
assert.ok(plugin, 'route preloads must be wired into the build')
const hook = plugin.transformIndexHtml
assert.ok(hook && typeof hook === 'object' && 'handler' in hook)
assert.equal(hook.order, 'post')
const transform = (html: string, bundle?: OutputBundle) => {
  const result = hook.handler(html, { bundle } as IndexHtmlTransformContext)
  assert.equal(typeof result, 'string')
  return result as string
}

// I6-2: generic 'vendor' (print/QR/ffmpeg, dynamic-import only) is not an
// admin startup chunk; it is listed in `excluded` below so re-adding it fails.
// I6-3: app-shared is a static import of both roots, so all three startup
// lists name it rather than leaving it to be discovered after the root parses.
const admin = ['AdminRoot', 'vendor-react', 'app-routing', 'app-shell', 'app-shared', 'Sidebar',
  'shared-ui', 'api-http-core', 'api-http-state', 'app-api', 'app-auth', 'app-bootstrap']
const login = ['AdminRoot', 'app-shared', 'auth-login', 'app-auth', 'app-bootstrap']
const publicChunks = ['PublicCatalogRoot', 'app-shell', 'app-shared', 'catalog-public-core', 'catalog-public-utils',
  'catalog-public', 'catalog-icons', 'catalog-products', 'route-sync-utils', 'app-portal', 'portal-tools']
const productShared = ['product-read-api', 'product-shared', 'productDisplayHelpers',
  'route-sync-utils', 'settings-refresh', 'app-api', 'shared-ui']
const otherRoutes: Record<string, string[]> = {
  inventory: ['Inventory', 'inventory-api', 'product-shared', 'shared-ui'],
  returns: ['Returns', 'returns-read-api'],
  users: ['Users', 'user-admin-api', 'user-permission-definitions'],
  branches: ['Branches', 'branch-api', 'product-shared', 'shared-page-header', 'route-sync-utils', 'api-local-cache', 'shared-ui'],
  backup: [], settings: [],
}
const excluded = ['unknown-future-chunk', 'vendor', 'file-picker-modal', 'image-lightbox', 'app-api-methods', 'app-system', 'app-local-db',
  'vendor-dexie', 'vendor-zxing', 'vendor-xlsx', 'media-upload-utils', 'notification-center',
  'background-import-tracker', 'write-conflict-modal', 'browser-dialogs', 'product-detail',
  'shared-portal-menu', 'action-history-api', 'ai-api', 'audit-log-api', 'branch-api',
  'contacts-api', 'csv-utils', 'dashboard-api', 'dashboard-charts', 'dashboard-export',
  'drive-sync-api', 'file-api', 'inventory-api', 'inventory-export', 'inventory-write-api',
  'import-jobs-api', 'multipart-headers-api', 'notification-api', 'pending-sync-api',
  'product-export', 'product-image-upload-api', 'api-local-cache', 'lookup-api',
  'product-write-api', 'rfid-api', 'returns-write-api', 'sale-write-api', 'sales-read-api',
  'system-jobs-api', 'catalog', 'catalog-secondary-tabs', 'catalog-editor',
  'portal-language-packs', 'portal-content-i18n', 'backup-reset-tools', 'settings-otp-modal',
  'settings-api', 'user-profile-modal', 'user-detail-sheet', 'user-permission-editor',
  'branch-transfer-modal', 'app-shell-icons', 'shared-icons', 'lang-en', 'lang-km']
const names = [...new Set([...admin, ...login, ...publicChunks, ...productShared, 'Products', 'POS', ...Object.values(otherRoutes).flat(), ...excluded])]
const fileFor = (name: string) => `assets/${name}-fixture.js`
const bundle = Object.fromEntries(names.map(name => [fileFor(name), {
  type: 'chunk', name, fileName: fileFor(name),
  // Even named route chunks must not recursively preload every static import.
  imports: excluded.map(fileFor), dynamicImports: excluded.map(fileFor),
}])) as unknown as OutputBundle
bundle['assets/not-a-chunk.js'] = {
  type: 'asset', fileName: 'assets/not-a-chunk.js', name: 'Products', source: 'asset',
} as OutputBundle[string]
const html = '<html><head><script type="module" src="/assets/index.js"></script></head></html>'
assert.equal(transform(html), html, 'development HTML has no emitted bundle')
const built = transform(html, bundle)
assert.equal(transform(built, bundle), built, 'HTML transform is idempotent')
assert.ok(built.indexOf('data-business-os-route-preloads') < built.indexOf('type="module"'), 'preloads run before the entry module')
const script = built.match(/<script data-business-os-route-preloads>([\s\S]*?)<\/script>/)?.[1]
assert.ok(script, 'plugin must emit an executable route preload script')

type Link = { rel?: string; href?: string; fetchPriority?: string; attributes: Record<string, string>; setAttribute: (name: string, value: string) => void }
function run(pathname: string, options: { publicRoot?: boolean; embedded?: boolean; existingPromise?: boolean; existingLink?: string; source?: string; rejectFetch?: boolean; unresolvedSignout?: boolean; blockedStorage?: boolean; deviceSettings?: string } = {}) {
  const links: Link[] = []
  const calls: Array<{ url: string; init: RequestInit }> = []
  const existingPromise = options.existingPromise ? Promise.resolve({ user: 'already-started' }) : undefined
  const window = {
    location: { pathname },
    get localStorage() {
      if (options.blockedStorage) throw new Error('Storage blocked')
      return { getItem: (key: string) => {
        if (key === 'businessos_unresolved_signout_v1') return options.unresolvedSignout ? 'retained-intent' : null
        if (key === 'businessos_device_settings') return options.deviceSettings ?? null
        return null
      } }
    },
    __businessOsAuthBootstrapPromise: existingPromise,
    fetch: (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (options.rejectFetch) return Promise.reject(new Error('expected bootstrap rejection'))
      return Promise.resolve({ ok: true, text: () => Promise.resolve('{"user":"fixture"}') })
    },
  }
  const document = {
    documentElement: { getAttribute: () => options.publicRoot ? 'public' : 'admin' },
    getElementById: (id: string) => options.embedded && id === 'business-os-auth-bootstrap' ? {} : null,
    querySelector: (selector: string) => options.existingLink && selector.includes(`href="${options.existingLink}"`) ? {} : null,
    createElement: (tag: string): Link => {
      assert.equal(tag, 'link')
      return { attributes: {}, setAttribute(name, value) { this.attributes[name] = value } }
    },
    head: { appendChild: (link: Link) => links.push(link) },
  }
  vm.runInNewContext(options.source ?? script!, { window, document })
  return { links, calls, window, existingPromise }
}
function expectRoute(pathname: string, expected: string[], publicRoot = false, source?: string, deviceSettings?: string) {
  const result = run(pathname, { publicRoot, source, deviceSettings })
  assert.deepEqual(result.links.map(link => link.href).sort(), [...new Set(expected)].map(name => '/' + fileFor(name)).sort(), pathname)
  for (const link of result.links) {
    assert.equal(link.rel, 'modulepreload')
    assert.equal(link.fetchPriority, 'high')
    assert.equal(link.attributes.fetchpriority, 'high')
  }
  return result
}
for (const path of ['/', '/shop', '/shop/products']) {
  assert.equal(expectRoute(path, publicChunks, true).calls.length, 0, 'public bootstrap must not request admin auth')
}
assert.equal(expectRoute('/my-store', publicChunks).calls.length, 0, 'public slugs also skip admin auth')
for (const path of ['/login', '/LOGIN//']) {
  assert.equal(expectRoute(path, login).calls.length, 0, 'login owns its sign-in flow')
}
for (const path of ['/', '/admin', '/dashboard']) expectRoute(path, admin)
for (const path of ['/products', '/product', '//PRODUCTS///?page=2#top']) expectRoute(path, [...admin, 'Products', ...productShared])
for (const path of ['/pos', '/point-of-sale']) expectRoute(path, [...admin, 'POS', ...productShared])
for (const [route, chunks] of Object.entries(otherRoutes)) expectRoute('/' + route, [...admin, ...chunks])

// I6-1: the device's stored non-English pack joins the admin and sign-in
// preloads, so it downloads alongside the admin chunks instead of after
// React's first commit. English never does -- CORE_ENGLISH_PACK paints it
// and AppProvider loads the full pack at idle -- and the storefront has its
// own packs. Unreadable or malformed storage means the English default.
const khmerDevice = JSON.stringify({ theme: 'dark', language: 'km' })
expectRoute('/', [...admin, 'lang-km'], false, undefined, khmerDevice)
expectRoute('/pos', [...admin, 'POS', ...productShared, 'lang-km'], false, undefined, khmerDevice)
expectRoute('/login', [...login, 'lang-km'], false, undefined, khmerDevice)
expectRoute('/', [...admin, 'lang-km'], false, undefined, JSON.stringify({ language: ' km ' }))
expectRoute('/', publicChunks, true, undefined, khmerDevice)
expectRoute('/shop', publicChunks, false, undefined, khmerDevice)
expectRoute('/', admin, false, undefined, JSON.stringify({ language: 'en' }))
expectRoute('/', admin, false, undefined, JSON.stringify({ theme: 'dark' }))
expectRoute('/', admin, false, undefined, 'not json')
expectRoute('/', admin, false, undefined, JSON.stringify({ language: 'fr' }))
assert.deepEqual(run('/', { blockedStorage: true }).links.map(link => link.href).sort(), admin.map(name => '/' + fileFor(name)).sort(), 'blocked storage preloads no pack')

const bootstrap = run('/products')
assert.equal(run('/products', { unresolvedSignout: true }).calls.length, 0, 'unresolved sign-out suppresses private early bootstrap')
assert.equal(run('/products', { blockedStorage: true }).calls.length, 0, 'unreadable intent storage fails closed before private bootstrap')
assert.deepEqual(run('/shop', { publicRoot: true, unresolvedSignout: true }).links.map(link => link.href), run('/shop', { publicRoot: true }).links.map(link => link.href), 'admin sign-out fence preserves public route preloads')
assert.equal(bootstrap.calls.length, 1)
assert.equal(bootstrap.calls[0].url, '/api/auth/bootstrap')
assert.equal(bootstrap.calls[0].init.credentials, 'include')
assert.equal(bootstrap.calls[0].init.redirect, 'manual')
assert.equal(JSON.stringify(await bootstrap.window.__businessOsAuthBootstrapPromise), '{"user":"fixture"}')
assert.equal(run('/products', { embedded: true }).calls.length, 0, 'embedded bootstrap suppresses fetch')
const started = run('/pos', { existingPromise: true })
assert.equal(started.calls.length, 0, 'existing bootstrap promise suppresses duplicate fetch')
assert.equal(started.window.__businessOsAuthBootstrapPromise, started.existingPromise)
const existingLink = '/' + fileFor('shared-ui')
assert.ok(!run('/products', { existingLink }).links.some(link => link.href === existingLink), 'existing modulepreloads are not duplicated')

// A missing output must not become a request for a guessed filename.
const partialBundle = { ...bundle }
delete partialBundle[fileFor('app-portal')]
const partialScript = transform(html, partialBundle).match(/<script data-business-os-route-preloads>([\s\S]*?)<\/script>/)?.[1]
assert.ok(partialScript)
expectRoute('/shop', publicChunks.filter(name => name !== 'app-portal'), true, partialScript)
console.log('PASS configured route preload plugin: public/admin/login/products/POS, exclusions, priority, deduplication and auth bootstrap')
const unhandled: unknown[] = []
const onUnhandled = (error: unknown) => unhandled.push(error)
process.on('unhandledRejection', onUnhandled)
try {
  const rejected = run('/products', { rejectFetch: true })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(unhandled, [], 'early rejection must be observed before modules load')
  await assert.rejects(rejected.window.__businessOsAuthBootstrapPromise!, /expected bootstrap rejection/)
} finally { process.off('unhandledRejection', onUnhandled) }
