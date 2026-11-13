// B3 (REVIEW-wave1-B): writeInvalidation.test.ts proves every WRITE family has an entry, not that every stock or money READ is
// cleared by some write. This walks the read channels the transports actually use (every non-write `route('<channel>', ...)`
// in src/api, found with the TypeScript AST) and asserts that for each stock or money channel, at least one write family
// clears a cached entry under it, through the real cache (so the per-entity read revision counts, as it does at runtime).
//
// A read channel nobody clears would show a pre-write number for the cache lifetime (20 s, 3,600 s on the Free tier).
// Run: node tests/readChannelCoverage.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { cacheClearAll, cacheGet, cacheInvalidate, cacheSet, setSyncServerUrl } from '../src/api/http.ts'
import { resetActorReadSession } from '../src/api/actorReadScope.ts'
import { WRITE_FAMILY_INVALIDATES } from '../src/api/writeInvalidation.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const storage = new Map<string, string>()
Object.assign(globalThis, {
  CustomEvent: class { type: string; detail: unknown; constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail } },
  window: {
    location: { origin: 'https://fixture.test', href: 'https://fixture.test/' },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v) }, removeItem: (k: string) => { storage.delete(k) } },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {},
  },
})
setSyncServerUrl('https://fixture.test')
storage.set('businessos_user', JSON.stringify({ id: 1 }))
resetActorReadSession()
cacheClearAll()

// The entities whose answers carry stock or money. The notification bell is deliberately absent (it polls on its own
// cadence); lookups, settings, users and the like change only through their own writes.
const STOCK_AND_MONEY_ENTITIES = [
  'products', 'inventory', 'batches', 'branches', 'transfers', 'inventoryChecks',
  'sales', 'returns', 'dashboard', 'analytics', 'fees', 'shifts', 'customers',
]

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Every channel head (`family:name`, a template's literal head) passed to a non-write route() call in the app. */
function readChannels(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of sourceFiles(path.join(srcRoot, 'api'))) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'route' && node.arguments[0]) {
        const options = node.arguments[3]
        const write = !!options && (options.kind === ts.SyntaxKind.TrueKeyword || (ts.isObjectLiteralExpression(options) && /isWrite:\s*true/.test(options.getText())))
        if (!write) {
          const heads: string[] = []
          const collect = (inner: ts.Node): void => {
            if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) || ts.isTemplateHead(inner)) heads.push(inner.text)
            ts.forEachChild(inner, collect)
          }
          collect(node.arguments[0])
          for (const head of heads) if (/^[A-Za-z]+:/.test(head)) found.set(head, path.relative(srcRoot, file))
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found
}

/** Channels no write family clears, judged through the real cache: cached under the channel, then every write family's prefixes applied. */
function uncleared(channels: Iterable<string>, map: Readonly<Record<string, readonly string[]>>): string[] {
  const out: string[] = []
  for (const channel of channels) {
    const cleared = Object.values(map).some((prefixes) => {
      cacheClearAll()
      cacheSet(channel, 'old')
      for (const prefix of prefixes) cacheInvalidate(prefix)
      return cacheGet(channel) === null
    })
    if (!cleared) out.push(channel)
  }
  cacheClearAll()
  return out
}

const all = readChannels()
const stockMoney = [...all.keys()].filter((channel) => STOCK_AND_MONEY_ENTITIES.includes(channel.split(':')[0]))

runTest('the scan finds the stock and money read channels (not an empty walk)', () => {
  assert.ok(stockMoney.length >= 35, `expected the transports' read channels, found ${stockMoney.length}`)
  for (const channel of ['products:get', 'sales:get', 'returns:records', 'branches:summary', 'inventory:stats', 'dashboard:startup', 'shifts:current', 'fees:get']) {
    assert.ok(stockMoney.some((found) => found === channel || found.startsWith(`${channel}:`)), `missing ${channel}`)
  }
})

runTest('every stock and money read channel is cleared by at least one write family', () => {
  const missing = uncleared(stockMoney, WRITE_FAMILY_INVALIDATES)
  assert.deepEqual(missing, [], `no write family clears: ${missing.map((channel) => `${channel} (${all.get(channel)})`).join(', ')}; add its prefix in src/api/writeInvalidation.ts`)
})

runTest('positive control: with the inventory writers removed from the map the walk reports the inventory reads', () => {
  const withoutInventory = Object.fromEntries(Object.entries(WRITE_FAMILY_INVALIDATES).map(([family, prefixes]) => [family, prefixes.filter((prefix) => prefix.split(':')[0] !== 'inventory')]))
  const missing = uncleared(stockMoney, withoutInventory)
  assert.ok(missing.some((channel) => channel.startsWith('inventory:stats')) && missing.some((channel) => channel.startsWith('inventory:movements')), `the control saw ${missing.join(', ')}`)
  assert.ok(!missing.some((channel) => channel.startsWith('sales:')), 'a channel that is still covered is not reported')
})

runTest('every prefix a write family clears names a real stock or money read entity or a lookup it feeds', () => {
  const entities = new Set([...STOCK_AND_MONEY_ENTITIES, 'categories', 'units', 'promotions'])
  for (const [family, prefixes] of Object.entries(WRITE_FAMILY_INVALIDATES)) {
    for (const prefix of prefixes) assert.ok(entities.has(prefix.split(':')[0]), `${family} clears an unknown entity ${prefix}`)
  }
})

if (failed > 0) process.exitCode = 1
