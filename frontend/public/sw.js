const STATIC_CACHE = 'business-os-static-v2'
const PAGE_CACHE = 'business-os-pages-v2'
const MEDIA_CACHE = 'business-os-media-v2'
const SHELL_URLS = ['/', '/manifest.json', '/icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => ![STATIC_CACHE, PAGE_CACHE, MEDIA_CACHE].includes(key))
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

function isStaticAsset(pathname) {
  return pathname.startsWith('/assets/')
    || pathname === '/manifest.json'
    || pathname === '/icon.png'
}

function isMediaAsset(pathname) {
  return pathname.startsWith('/uploads/')
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {})
      }
      return response
    })
    .catch(() => cached)

  return cached || networkPromise
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {})
    }
    return response
  } catch (_) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw _
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || !isSameOrigin(request.url)) return

  const url = new URL(request.url)

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, PAGE_CACHE).catch(async () => {
        return caches.match('/') || Response.error()
      })
    )
    return
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE))
    return
  }

  if (isMediaAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, MEDIA_CACHE))
  }
})
