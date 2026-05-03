'use strict'

const {
  CACHE_REDIS_URL,
  DATABASE_DRIVER,
  RUNTIME_CACHE_ENABLED,
} = require('./config')

const CACHE_PREFIX = String(process.env.RUNTIME_CACHE_PREFIX || 'business-os:v1').trim() || 'business-os:v1'
const DEFAULT_TTL_SECONDS = Math.min(300, Math.max(5, Number(process.env.RUNTIME_CACHE_TTL_SECONDS || 30) || 30))

let client = null
let connectPromise = null
let lastError = ''
let lastReadyAt = null

function enabled() {
  return !!(RUNTIME_CACHE_ENABLED && CACHE_REDIS_URL)
}

function namespacedKey(key) {
  const safeKey = String(key || '').trim().replace(/\s+/g, ':')
  return `${CACHE_PREFIX}:${DATABASE_DRIVER || 'postgres'}:${safeKey}`
}

async function getClient() {
  if (!enabled()) return null
  if (client?.status === 'ready') return client
  if (connectPromise) return connectPromise

  connectPromise = (async () => {
    try {
      const IORedis = require('ioredis')
      if (!client) {
        client = new IORedis(CACHE_REDIS_URL, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 750,
          commandTimeout: 1000,
          family: 4,
        })
        client.on('error', (error) => {
          lastError = error?.message || String(error || 'Redis cache error')
        })
        client.on('ready', () => {
          lastReadyAt = new Date().toISOString()
          lastError = ''
        })
      }
      if (client.status !== 'ready') await client.connect()
      return client
    } catch (error) {
      lastError = error?.message || String(error || 'Runtime cache unavailable')
      return null
    } finally {
      connectPromise = null
    }
  })()

  return connectPromise
}

async function getJson(key) {
  const redis = await getClient()
  if (!redis) return null
  try {
    const raw = await redis.get(namespacedKey(key))
    if (!raw) return null
    return JSON.parse(raw)
  } catch (error) {
    lastError = error?.message || String(error || 'Runtime cache read failed')
    return null
  }
}

async function setJson(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const redis = await getClient()
  if (!redis) return false
  try {
    const ttl = Math.min(3600, Math.max(1, Number(ttlSeconds || DEFAULT_TTL_SECONDS) || DEFAULT_TTL_SECONDS))
    await redis.set(namespacedKey(key), JSON.stringify(value), 'EX', ttl)
    return true
  } catch (error) {
    lastError = error?.message || String(error || 'Runtime cache write failed')
    return false
  }
}

async function getOrSetJson(key, ttlSeconds, producer) {
  const cached = await getJson(key)
  if (cached != null) return cached
  const value = await producer()
  await setJson(key, value, ttlSeconds)
  return value
}

async function deleteByPrefix(prefix) {
  const redis = await getClient()
  if (!redis) return 0
  const match = `${namespacedKey(prefix)}*`
  let cursor = '0'
  let removed = 0
  try {
    do {
      const result = await redis.scan(cursor, 'MATCH', match, 'COUNT', 100)
      cursor = result[0]
      const keys = result[1] || []
      if (keys.length) removed += await redis.del(...keys)
    } while (cursor !== '0')
  } catch (error) {
    lastError = error?.message || String(error || 'Runtime cache invalidation failed')
  }
  return removed
}

function prefixesForChannel(channel) {
  const value = String(channel || '').trim().toLowerCase()
  if (!value) return []
  const prefixes = new Set()
  if (['settings', 'portal', 'runtime'].includes(value)) {
    prefixes.add('portal:')
    prefixes.add('dashboard:')
  }
  if (['products', 'inventory', 'branches', 'categories', 'units', 'suppliers'].includes(value)) {
    prefixes.add('portal:')
    prefixes.add('products:')
    prefixes.add('inventory:')
    prefixes.add('dashboard:')
  }
  if (['sales', 'returns', 'customers'].includes(value)) {
    prefixes.add('dashboard:')
    prefixes.add('customers:')
  }
  return [...prefixes]
}

async function invalidateForChannel(channel) {
  const prefixes = prefixesForChannel(channel)
  if (!prefixes.length) return { removed: 0, prefixes: [] }
  const removed = await Promise.all(prefixes.map((prefix) => deleteByPrefix(prefix)))
  return {
    prefixes,
    removed: removed.reduce((sum, count) => sum + Number(count || 0), 0),
  }
}

async function pingRuntimeCache() {
  const redis = await getClient()
  if (!redis) return false
  try {
    return (await redis.ping()) === 'PONG'
  } catch (error) {
    lastError = error?.message || String(error || 'Runtime cache ping failed')
    return false
  }
}

function getRuntimeCacheStatus() {
  return {
    enabled: enabled(),
    configured: !!CACHE_REDIS_URL,
    url: CACHE_REDIS_URL ? CACHE_REDIS_URL.replace(/\/\/([^:@/]+):[^@/]+@/, '//***:***@') : '',
    status: client?.status || 'idle',
    lastReadyAt,
    lastError,
  }
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  deleteByPrefix,
  getJson,
  getOrSetJson,
  getRuntimeCacheStatus,
  invalidateForChannel,
  pingRuntimeCache,
  setJson,
}
