#!/usr/bin/env node
/* eslint-disable no-console */

const baseUrl = String(process.argv[2] || 'http://127.0.0.1:4000').replace(/\/$/, '')
const args = new Set(process.argv.slice(3))
const skipIfUnavailable = args.has('--skip-if-unavailable')

const routes = [
  { name: 'health', path: '/health', allowed: new Set([200]), public: true },
  { name: 'products search', path: '/api/products/search?page=1&pageSize=1', allowed: new Set([200, 401, 403]) },
  { name: 'products filters', path: '/api/products/filters', allowed: new Set([200, 401, 403]) },
  { name: 'inventory products search', path: '/api/inventory/products/search?page=1&pageSize=1', allowed: new Set([200, 401, 403]) },
  { name: 'portal catalog search', path: '/api/portal/catalog/products/search?page=1&pageSize=1', allowed: new Set([200]) },
  { name: 'branch stock search', path: '/api/branches/1/stock?page=1&pageSize=1', allowed: new Set([200, 401, 403]) },
  { name: 'import review', path: '/api/import-jobs/contract-smoke/review?page=1&pageSize=1', allowed: new Set([200, 401, 403]) },
  { name: 'import decisions', method: 'PATCH', path: '/api/import-jobs/contract-smoke/decisions', allowed: new Set([200, 401, 403]) },
  { name: 'import delete', method: 'DELETE', path: '/api/import-jobs/contract-smoke?force=1', allowed: new Set([200, 401, 403]) },
  { name: 'action history undo', method: 'POST', path: '/api/action-history/contract-smoke/undo', allowed: new Set([200, 401, 403]) },
  { name: 'action history redo', method: 'POST', path: '/api/action-history/contract-smoke/redo', allowed: new Set([200, 401, 403]) },
  { name: 'backup job create', method: 'POST', path: '/api/backups', allowed: new Set([200, 401, 403]) },
  { name: 'backup job restore', method: 'POST', path: '/api/backups/contract-smoke/restore', allowed: new Set([200, 401, 403]) },
  { name: 'drive sync job create', method: 'POST', path: '/api/system/drive-sync/jobs', allowed: new Set([200, 401, 403]) },
  { name: 'storage mode diagnostics', path: '/api/system/storage-mode', allowed: new Set([200, 401, 403]) },
]

function fail(message) {
  console.error(`[route-contract] ${message}`)
  process.exitCode = 1
}

async function checkRoute(route) {
  const url = `${baseUrl}${route.path}`
  let response
  try {
    response = await fetch(url, {
      method: route.method || 'GET',
      headers: { 'bypass-tunnel-reminder': 'true' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new Error(`${route.name} request failed: ${error?.message || error}`)
  }

  const contentType = response.headers.get('content-type') || ''
  const text = await response.text().catch(() => '')
  if (response.status === 404) {
    throw new Error(`${route.name} returned 404 at ${route.path}`)
  }
  if (route.path.startsWith('/api/') && /^text\/html\b/i.test(contentType)) {
    throw new Error(`${route.name} returned HTML instead of an API response at ${route.path}`)
  }
  if (!route.allowed.has(response.status)) {
    throw new Error(`${route.name} returned ${response.status}; expected ${Array.from(route.allowed).join('/')}. ${text.slice(0, 200)}`)
  }
  console.log(`[route-contract] OK ${route.name}: ${response.status}`)
}

async function main() {
  try {
    await checkRoute(routes[0])
  } catch (error) {
    if (skipIfUnavailable) {
      console.warn(`[route-contract] skipped: ${baseUrl} is unavailable (${error?.message || error})`)
      return
    }
    throw error
  }

  for (const route of routes.slice(1)) {
    await checkRoute(route)
  }
}

main().catch((error) => {
  fail(error?.message || String(error))
})
