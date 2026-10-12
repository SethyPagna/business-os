// The History bar never offers an Undo/Redo that the Worker is certain to refuse.
// Real bundled Worker, real pair merge, real GET /api/action-history; every offered
// row is clicked with the body the REAL frontend buildServerReplayRequest builds.
// A v2 product.merge row replays only with expected_generation, which that builder
// does not send for product.merge, so the row must not be offered until it does.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
const h = require('./test-counted-quantity-exact-native.cjs')
const pair = require('./test-product-merge-pair-http-native.cjs')

const frontend = path.join(__dirname, '..', '..', 'frontend', 'src')
function frontendReplayRequestBuilder() {
  const source = fs.readFileSync(path.join(frontend, 'utils', 'actionHistory.ts'), 'utf8')
  const tree = ts.createSourceFile('actionHistory.ts', source, ts.ScriptTarget.Latest, true)
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'buildServerReplayRequest')
  assert.ok(declaration, 'frontend buildServerReplayRequest exists')
  assert.ok(/const replayRequest = buildServerReplayRequest\(payload\)/.test(source), 'runServerEntry sends the builder body')
  const bar = fs.readFileSync(path.join(frontend, 'components', 'shared', 'ActionHistoryBar.tsx'), 'utf8')
  assert.ok(/const serverActionable = !!item\?\.server_replayable\s*&& \(item\?\.status === 'undoable' \|\| item\?\.status === 'redoable'\)/.test(bar),
    'the History bar offers a server row exactly when server_replayable and the status is undoable/redoable')
  const module = { exports: {} }
  new Function('module', 'exports', ts.transpileModule(declaration.getText(tree), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(module, module.exports)
  return module.exports.buildServerReplayRequest
}
const buildServerReplayRequest = frontendReplayRequestBuilder()
const offered = item => !!item?.server_replayable && ['undoable', 'redoable'].includes(item.status) && item.id != null

async function listed(f) {
  const items = []
  for (const scope of ['products', 'branches']) {
    const list = await f.call(`/action-history?scope=${scope}&limit=20`, undefined, 'GET')
    assert.equal(list.status, 200, JSON.stringify(list.json))
    items.push(...list.json.items)
  }
  return items
}
async function clickEveryOffered(f, items, where) {
  const clicks = []
  for (const item of items.filter(offered)) {
    const direction = item.status === 'redoable' ? 'redo' : 'undo'
    const body = buildServerReplayRequest(item[direction === 'undo' ? 'undo_payload' : 'redo_payload'])
    const result = await f.call(`/action-history/${item.id}/${direction}`, body)
    const click = { where, applier: item.undo_payload?.applier, version: item.undo_payload?.version ?? null, direction, status: result.status, code: result.json.code ?? null }
    assert.ok(result.status === 200 && result.json.applied === true, `offered History row refused by the Worker: ${JSON.stringify(click)}`)
    clicks.push(click)
  }
  return clicks
}

async function run(makeWorker) {
  for (const tier of ['free', 'paid']) {
    const f = await pair.world(makeWorker, tier, true, true)
    try {
      const merged = await f.call('/products/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge', client_request_id: 'history-offer-merge' })
      assert.equal(merged.status, 200, JSON.stringify(merged.json))
      const branch = f.sql.prepare('SELECT notes FROM branches WHERE id=1').get()
      const control = await f.call('/action-history', { scope: 'branches', entity: 'branch', entity_id: '1', label: 'Branch notes offer control',
        undo_payload: { applier: 'branch.update', id: 1, fields: { notes: 'Offer control before' } },
        redo_payload: { applier: 'branch.update', id: 1, fields: { notes: branch.notes } } })
      assert.equal(control.status, 200, JSON.stringify(control.json))

      const items = await listed(f)
      const mergeRow = items.find(item => Number(item.id) === Number(merged.json.actionHistoryId))
      assert.equal(mergeRow?.undo_payload?.applier, 'product.merge'); assert.equal(mergeRow.undo_payload.version, 2); assert.equal(mergeRow.status, 'undoable')
      const controlRow = items.find(item => Number(item.id) === Number(control.json.id))
      assert.equal(offered(controlRow), true, 'positive control: a server-replayable row is still offered')
      const clicks = await clickEveryOffered(f, items, 'list')
      assert.equal(offered(mergeRow), false, 'a v2 merge row is offered only once the History bar sends expected_generation for it')
      assert.deepEqual(clicks.map(click => click.applier), ['branch.update'], 'the control row was clicked and the merge row was not offered')
      assert.equal(f.sql.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'Offer control before')

      // A direct API replay (which does send expected_generation) still works; the item it
      // returns replaces the bar's row, so it obeys the same rule.
      const replay = await f.call(`/action-history/${mergeRow.id}/undo`, { require_applied: true, expected_generation: mergeRow.undo_payload.generation })
      assert.equal(replay.status, 200, JSON.stringify(replay.json)); assert.equal(replay.json.applied, true)
      assert.equal(replay.json.item.status, 'redoable')
      await clickEveryOffered(f, [replay.json.item], 'replay response')
      assert.equal(offered(replay.json.item), false, 'the replay response item is not offered either')
      const after = await listed(f)
      await clickEveryOffered(f, after, 'list after replay')
      assert.equal(offered(after.find(item => Number(item.id) === Number(mergeRow.id))), false)
      console.log(`PASS ${tier}: v2 merge row not offered (list, replay response, list after replay); offered control row replays with the frontend body`)
    } finally { f.sql.close() }
  }
}

async function main() { await run(await h.bundle.exports.bundleWorker()) }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { run }
