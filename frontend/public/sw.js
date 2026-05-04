/**
 * Business OS offline app shell service worker.
 *
 * This caches only the application shell and static build assets. API calls,
 * uploads, and user media always go to the live server or fail so business data
 * cannot be silently replaced by stale HTTP responses.
 */

const APP_SHELL_CACHE = 'business-os-app-shell-v1'
const STATIC_CACHE = 'business-os-static-v4'
const APP_SHELL_URLS = ['/', '/index.html', '/manifest.json', '/icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => key.startsWith('business-os-') && ![APP_SHELL_CACHE, STATIC_CACHE].includes(key))
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

function isNeverCachedPath(pathname) {
  return pathname.startsWith('/api/')
    || pathname === '/health'
    || pathname.startsWith('/uploads/')
    || pathname.startsWith('/files/')
    || pathname.startsWith('/portal/uploads/')
}

function isCacheableStaticPath(pathname) {
  return pathname.startsWith('/assets/')
    || pathname === '/manifest.json'
    || pathname === '/icon.png'
    || pathname === '/runtime-noise-guard.js'
    || pathname === '/theme-bootstrap.js'
}

async function appShellFallback(request) {
  const cache = await caches.open(APP_SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response && response.ok && response.type === 'basic') {
      cache.put('/index.html', response.clone()).catch(() => {})
    }
    return response
  } catch (error) {
    const cached = await cache.match('/index.html') || await cache.match('/')
    if (cached) return cached
    throw error
  }
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
  } catch (error) {
    if (cached) return cached
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (!isSameOrigin(request.url)) return

  const url = new URL(request.url)
  if (isNeverCachedPath(url.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(appShellFallback(request))
    return
  }

  if (!isCacheableStaticPath(url.pathname)) return
  event.respondWith(networkFirstStatic(request))
})
