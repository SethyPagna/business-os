// SCAN2 RT-11: every write woke two Durable Objects, the APAC hub and the
// legacy 'global' hub, forever. Sockets attach only to the APAC hub (pinned by
// test-broadcast-hub-apac-pure.cjs), so once the legacy hub reports no
// recipients it can never gain one again, and waking it is pure cost.
//
// Loads the REAL broadcastHub.ts broadcast() against a fake DO namespace.
//
// Run: node scripts/test-broadcast-legacy-hub-drain-pure.cjs
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadBroadcastHub() {
  const sourcePath = path.join(__dirname, '..', 'src', 'durable-objects', 'broadcastHub.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  })
  const loaded = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(
    loaded.exports,
    (request) => { throw new Error(`broadcastHub.ts required an unstubbed module: ${request}`) },
    loaded,
  )
  return loaded.exports
}

function hubNamespace(responses) {
  const posts = []
  return {
    posts,
    namespace: {
      idFromName: (name) => name,
      get: (id) => ({
        async fetch(url, init) {
          posts.push(id)
          const respond = responses[id]
          return respond ? respond() : Response.json({ ok: true, recipients: 1 })
        },
      }),
    },
  }
}

const recipients = (count) => () => Response.json({ ok: true, recipients: count })

const tests = []
function check(name, fn) { tests.push({ name, fn }) }

check('while old tabs remain on the legacy hub, every write reaches both hubs', async () => {
  const { broadcast } = loadBroadcastHub()
  const { posts, namespace } = hubNamespace({ global: recipients(2) })
  await broadcast({ BROADCAST_HUB: namespace }, 'products', { id: 1 })
  await broadcast({ BROADCAST_HUB: namespace }, 'sales', { id: 2 })
  assert.deepEqual(posts.sort(), ['global', 'global', 'global-apac', 'global-apac'])
})

check('once the legacy hub reports no recipients it is no longer woken', async () => {
  const { broadcast } = loadBroadcastHub()
  const { posts, namespace } = hubNamespace({ global: recipients(0) })
  await broadcast({ BROADCAST_HUB: namespace }, 'products', { id: 1 })
  posts.length = 0
  for (let i = 0; i < 5; i++) await broadcast({ BROADCAST_HUB: namespace }, 'inventory', { id: i })
  assert.deepEqual(posts, ['global-apac', 'global-apac', 'global-apac', 'global-apac', 'global-apac'])
})

check('an unreadable legacy answer is not taken as empty', async () => {
  for (const respond of [
    () => new Response('overloaded', { status: 503 }),
    () => new Response('not json', { status: 200 }),
    () => Response.json({ ok: true }),
  ]) {
    const { broadcast } = loadBroadcastHub()
    const { posts, namespace } = hubNamespace({ global: respond })
    await broadcast({ BROADCAST_HUB: namespace }, 'products')
    posts.length = 0
    await broadcast({ BROADCAST_HUB: namespace }, 'products')
    assert.deepEqual(posts.sort(), ['global', 'global-apac'])
  }
})

check('a failing hub never throws into the route that broadcast', async () => {
  const { broadcast } = loadBroadcastHub()
  const { namespace } = hubNamespace({ 'global-apac': () => { throw new Error('DO unavailable') } })
  const originalError = console.error
  console.error = () => {}
  try {
    await broadcast({ BROADCAST_HUB: namespace }, 'products')
  } finally {
    console.error = originalError
  }
})

async function main() {
  let failed = 0
  for (const test of tests) {
    try {
      await test.fn()
      console.log(`PASS ${test.name}`)
    } catch (error) {
      failed++
      console.error(`FAIL ${test.name}\n  ${error && error.message}`)
    }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
}

main()
