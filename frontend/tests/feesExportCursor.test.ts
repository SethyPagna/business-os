import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { createRequire } from 'node:module'
import * as retryRecordScope from '../src/api/retryRecordScope.ts'

// The Expenses export (getAllFeesForExport) against a model of the Worker's two behaviours (cloudflare/src/routes/feesCatalog.ts):
//   switch ON  (`expense_reads`): `cursor=start` starts a cursor export; every page carries `next_cursor` (null after the last) and the rows
//              the export covers are fixed by its first page, so a row created mid-export is in no page;
//   switch OFF: the parameter is ignored and the page is the offset page, exactly as before.
// The client sends `offset` (rows gathered so far) on EVERY request, so a switch turned off mid-export continues where the cursor stopped.
const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL('../src/api/feesTransport.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

type Row = { id: number }
type Server = { rows: Row[]; on: boolean; cap: number; requests: URLSearchParams[]; beforeRequest?: (n: number, server: Server) => void; repeatCursor?: boolean }

function loadTransport(text = source) {
  let server!: Server
  const module = { exports: {} as any }
  new Function('exports', 'require', 'module', ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(module.exports, (id: string) => {
    if (id === './http.ts') return {
      route: (_channel: string, work: () => unknown) => work(),
      apiFetch: async (_method: string, path: string) => {
        const query = new URL(path, 'https://test.invalid').searchParams
        server.requests.push(query)
        server.beforeRequest?.(server.requests.length, server)
        return answer(server, query)
      },
    }
    if (id === './query.ts') return require('../src/api/query.ts')
    if (id.includes('moneyPrecision')) return require('../src/utils/moneyPrecision.ts')
    if (id.includes('businessTimeBounds')) return require('../src/utils/businessTimeBounds.ts')
    if (id.includes('syncProblemLifecycle')) return {}
    if (id.includes('feeTypeName')) return require('../src/utils/feeTypeName.ts')
    if (id.includes('directMutationRefusal')) return require('../src/utils/directMutationRefusal.ts')
    if (id === './retryRecordScope.ts') return retryRecordScope
    throw new Error(id)
  }, module)
  return (next: Server) => { server = next; return module.exports.getAllFeesForExport({ source: 'all' }) as Promise<Row[]> }
}

const newest = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: count - i }))

// The Worker, in miniature. A cursor is `<last id served>.<highest id at the start>`.
function answer(server: Server, query: URLSearchParams) {
  const limit = Number(query.get('limit'))
  const cursorText = query.get('cursor')
  if (server.on && cursorText) {
    const first = cursorText === 'start'
    const [last, hi] = first ? [Infinity, Math.max(0, ...server.rows.map((r) => r.id))] : cursorText.split('.').map(Number)
    const eligible = server.rows.filter((r) => r.id < last && r.id <= hi)
    const size = Math.min(limit, server.cap)
    const page = eligible.slice(0, size)
    const more = eligible.length > size
    return {
      fees: page, limit: size, ...(first ? { total: server.rows.filter((r) => r.id <= hi).length, offset: 0 } : {}),
      has_more: more, next_cursor: server.repeatCursor && !first ? cursorText : more ? `${page.length ? page[page.length - 1].id : 0}.${hi}` : null,
    }
  }
  const offset = Number(query.get('offset') || 0)
  return { fees: server.rows.slice(offset, offset + Math.min(limit, 500)), total: server.rows.length, limit, offset, summary: [] }
}

const ids = (rows: Row[]) => rows.map((r) => r.id)
const fresh = (count: number, extra: Partial<Server> = {}): Server => ({ rows: newest(count), on: true, cap: 250, requests: [], ...extra })
const flipOffAtRequest = (n: number) => (at: number, s: Server) => { if (at === n) s.on = false }

// 1. Switch ON: every row once, in order, over pages the client did not size (the Worker caps a page at 250).
{
  const server = fresh(1203)
  const rows = await loadTransport()(server)
  assert.deepEqual(ids(rows), ids(newest(1203)))
  assert.equal(server.requests.length, 5, '1203 rows over pages of 250')
  assert.equal(server.requests[0].get('cursor'), 'start')
  assert.equal(server.requests[0].get('offset'), '0')
  assert.equal(server.requests[1].get('offset'), '250', 'the offset is the number of rows gathered, not a multiple of the requested page')
  assert.ok(server.requests.slice(1).every((q) => q.get('cursor') && q.get('cursor') !== 'start'))
  assert.ok(server.requests.every((q) => q.get('source') === 'all' && q.get('limit') === '500'))
}

// 2. Switch OFF: the parameter is ignored; offset pages, exactly the old request sequence plus an ignored `cursor=start` on the first.
{
  const server = fresh(1203, { on: false })
  const rows = await loadTransport()(server)
  assert.deepEqual(ids(rows), ids(newest(1203)))
  assert.deepEqual(server.requests.map((q) => q.get('offset')), ['0', '500', '1000'])
  assert.deepEqual(server.requests.map((q) => q.get('cursor')), ['start', null, null], 'the cursor is asked for once; an offset answer is never followed by a cursor request')
}

// 3. The switch turned off mid-export: the next request carries the offset, so the export continues with no row twice and none missing.
{
  const server = fresh(1203, { beforeRequest: flipOffAtRequest(3) })
  const rows = await loadTransport()(server)
  assert.deepEqual(ids(rows), ids(newest(1203)), 'ON for two pages (500 rows), then OFF')
  assert.equal(server.requests[2].get('offset'), '500')
}

// 4. The switch turned on mid-export: the first answers were offset pages, so the client holds no cursor and finishes by offset.
{
  const server = fresh(1203, { on: false, beforeRequest: (n, s) => { if (n === 2) s.on = true } })
  assert.deepEqual(ids(await loadTransport()(server)), ids(newest(1203)))
}

// 5. A row created or deleted mid-export: the cursor export has exactly the rows of its start; the offset export (today's) repeats a row after an insert and skips one after a delete.
{
  const insert = (n: number, s: Server) => { if (n === 2) s.rows.unshift({ id: 5000 }) }
  const cursorRows = await loadTransport()(fresh(1203, { beforeRequest: insert }))
  assert.deepEqual(ids(cursorRows), ids(newest(1203)), 'cursor export: the snapshot, no duplicate, no gap, the new row in no page')
  const offsetRows = await loadTransport()(fresh(1203, { on: false, beforeRequest: insert }))
  assert.ok(new Set(ids(offsetRows)).size < offsetRows.length, 'control: the offset export shifts and repeats a row')
  const servedRowGone = (n: number, s: Server) => { if (n === 2) s.rows = s.rows.filter((r) => r.id !== 1200) }
  const afterDelete = await loadTransport()(fresh(1203, { beforeRequest: servedRowGone }))
  assert.deepEqual(ids(afterDelete), ids(newest(1203)), 'cursor export: a row served before it was deleted stays, and nothing else moves')
  const offsetAfterDelete = await loadTransport()(fresh(1203, { on: false, beforeRequest: servedRowGone }))
  assert.ok(ids(newest(1203)).filter((id) => id !== 1200).some((id) => !ids(offsetAfterDelete).includes(id)), 'control: the offset export skips a row that was never deleted')
}

// 6. A row deleted mid-export, ahead of the cursor: every other row is still there once.
{
  const rows = await loadTransport()(fresh(1203, { beforeRequest: (n, s) => { if (n === 3) s.rows = s.rows.filter((r) => r.id !== 100) } }))
  assert.equal(new Set(ids(rows)).size, rows.length, 'no duplicate')
  assert.deepEqual(ids(rows), ids(newest(1203)).filter((id) => id !== 100))
}

// 7. Malformed answers cannot spin the loop: a Worker that hands the same cursor back, and one whose page is empty while it says more follows.
{
  const server = fresh(1203, { repeatCursor: true })
  const rows = await loadTransport()(server)
  assert.equal(server.requests.length, 2, 'the cursor handed back unchanged ends the export')
  assert.equal(rows.length, 500)
  const empty = fresh(1203, { cap: 0 })
  assert.deepEqual(await loadTransport()(empty), [])
  assert.equal(empty.requests.length, 1)
}

// 8. An empty export is an empty list and one request.
{
  const server = fresh(0)
  assert.deepEqual(await loadTransport()(server), [])
  assert.equal(server.requests.length, 1)
}

// 9. Mutants of the client: each must turn a scenario above red.
{
  const mutants: Array<{ name: string; from: string; to: string; scenario: () => Promise<void> }> = [
    {
      name: 'the offset is not sent with a cursor',
      from: 'offset: all.length, ...(cursor ? { cursor } : {})', to: '...(cursor ? { cursor } : { offset: all.length })',
      scenario: async (server = fresh(1203, { beforeRequest: flipOffAtRequest(3) })) => { assert.deepEqual(ids(await run(server)), ids(newest(1203))) },
    },
    {
      name: 'a short page ends a cursor export',
      from: 'if (!result.next_cursor || result.next_cursor === cursor) break', to: 'if (!result.next_cursor || rows.length < 500) break',
      scenario: async (server = fresh(1203)) => { assert.deepEqual(ids(await run(server)), ids(newest(1203))) },
    },
    {
      name: 'the cursor is asked for again after an offset answer',
      from: '    cursor = null\n    if (rows.length < PAGE', to: '    if (rows.length < PAGE',
      scenario: async (server = fresh(1203, { on: false })) => { await run(server); assert.deepEqual(server.requests.map((q) => q.get('cursor')), ['start', null, null]) },
    },
    {
      name: 'an offset export ignores the total and asks once more at the end',
      from: 'if (rows.length < PAGE || all.length >= total) break', to: 'if (rows.length < PAGE) break',
      scenario: async (server = fresh(1000, { on: false })) => { assert.deepEqual(ids(await run(server)), ids(newest(1000))); assert.equal(server.requests.length, 2) },
    },
  ]
  let run: ReturnType<typeof loadTransport> = loadTransport()
  const surviving: string[] = []
  for (const mutant of mutants) {
    assert.equal(source.split(mutant.from).length, 2, `mutant "${mutant.name}" must apply once`)
    run = loadTransport(source.replace(mutant.from, () => mutant.to))
    try { await mutant.scenario() } catch { continue }
    surviving.push(mutant.name)
  }
  assert.deepEqual(surviving, [], `mutants that stayed green: ${surviving.join(', ')}`)
}

console.log('PASS expense export cursor: cursor pages, offset fallback, switch flipped either way mid-export, a row created or deleted mid-export, malformed answers, mutants')
