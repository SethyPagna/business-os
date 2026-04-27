/**
 * Minimal Business OS service worker.
 *
 * Intentional constraints:
 * - Cache static same-origin build assets only.
 * - Do not cache HTML navigations.
 * - Do not cache API responses.
 * - Do not cache uploads or user-generated media.
 *
 * This keeps the worker useful for repeat visits on slow links without turning
 * it into an offline data layer that can serve stale business data after deploys.
 */

const STATIC_CACHE = 'business-os-static-v3'
const PRECACHE_URLS = ['/manifest.json', '/icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => key.startsWith('business-os-') && key !== STATIC_CACHE)
        .map((key) => caches.delete(key))
    )
    await self.clients.claim()
  })())
})

function isSameOrigin(requestUrl) {
  try {
    return new URL(requestUrl).origin === self.location.origin
  } catch (_) {
    return false
  }
}

function isCacheableStaticPath(pathname) {
  return pathname.startsWith('/assets/')
    || pathname === '/manifest.json'
    || pathname === '/icon.png'
}

async function networkFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)

  try {
    const response = await fetch(request)
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {})
    }
    return response
  } catch (_) {
    if (cached) return cached
    throw _
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (!isSameOrigin(request.url)) return
  if (request.mode === 'navigate') return

  const url = new URL(request.url)
  if (!isCacheableStaticPath(url.pathname)) return

  event.respondWith(networkFirstStatic(request))
})
