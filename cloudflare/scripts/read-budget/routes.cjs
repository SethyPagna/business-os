'use strict'
// The routes the bundled Worker registers: src/index.ts is bundled with `app` exported and Hono's own route table is read
// back (middleware entries without a concrete path are dropped). No workerd, no D1.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const ROOT = path.resolve(__dirname, '..', '..')

async function registeredRoutes() {
  const exportApp = {
    name: 'export-app',
    setup(b) {
      b.onLoad({ filter: /src[\\/]index\.ts$/ }, async (args) => ({ contents: fs.readFileSync(args.path, 'utf8') + '\nexport const __budgetApp = app\n', loader: 'ts', resolveDir: path.dirname(args.path) }))
    },
  }
  const out = await build({ entryPoints: [path.join(ROOT, 'src', 'index.ts')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], plugins: [exportApp], logLevel: 'error',
    define: { __WORKER_BUILD_REVISION__: '"routes"', __WORKER_BUILD_HASH__: '"routes"', __WORKER_BUILT_AT__: '"2026-11-02T00:00:00Z"' },
    alias: { 'cloudflare:workers': path.join(__dirname, 'cloudflare-workers-stub.mjs') } })
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'read-budget-routes-')), 'worker.mjs')
  fs.writeFileSync(file, out.outputFiles[0].text)
  try {
    const mod = await import('file:///' + file.replace(/\\/g, '/'))
    const seen = new Map()
    for (const r of mod.__budgetApp.routes) {
      if (r.method === 'ALL' && /\*/.test(r.path)) continue
      seen.set(`${r.method} ${r.path}`, { method: r.method, route: r.path })
    }
    return [...seen.values()].sort((a, b) => (a.route + a.method).localeCompare(b.route + b.method))
  } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }) }
}

// The template a concrete path belongs to: the registered path of the same method with the fewest parameters that matches.
function matchRoute(routes, method, pathname) {
  let best = null
  for (const r of routes) {
    if (r.method !== method && r.method !== 'ALL') continue
    const rx = new RegExp('^' + r.route.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+(\\\?)?/g, '[^/]+') + '/?$')
    if (rx.test(pathname)) {
      const params = (r.route.match(/:\w+/g) || []).length
      if (!best || params < best.params) best = { ...r, params }
    }
  }
  return best
}

module.exports = { registeredRoutes, matchRoute }
