// Disk cache for provider lookups, keyed by a hash of (provider name, query
// type, query value). verify-products.mjs uses this so a re-run (after a
// crash, or to add more products) never re-issues a search that already
// succeeded -- important both for rate limits and because a paid search API
// bills per call. The cache directory is gitignored (see
// ops/product-verification/.gitignore); nothing here is committed evidence,
// it is only a local speed/cost optimization.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export function cacheKeyFor(providerName, queryType, queryValue) {
  const raw = `${providerName}${queryType}${String(queryValue)}`
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export class DiskCache {
  constructor(dir) {
    this.dir = dir
    fs.mkdirSync(dir, { recursive: true })
  }

  pathFor(key) {
    return path.join(this.dir, `${key}.json`)
  }

  get(key) {
    const file = this.pathFor(key)
    if (!fs.existsSync(file)) return undefined
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return undefined
    }
  }

  set(key, value) {
    fs.writeFileSync(this.pathFor(key), JSON.stringify(value, null, 2), 'utf8')
  }
}

export function sleep(ms) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}
