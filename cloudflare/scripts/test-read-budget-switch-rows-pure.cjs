'use strict'
// read-budget/switches.cjs: a shape that names read switches (the ic_simple GET shapes, the Inventory Check write shapes) adds them around its one request
// and the PASS'S OWN switches are back afterwards. Composition of two lanes: the Inventory Check harness wrote its switches with INSERT OR REPLACE and cleared
// them with DELETE, which drops the switches a pass boots with (call_counting for the write pass, the report and expense switches for the GET passes) from
// every shape that runs after it. The row is faked here: what matters is the document stored after each step.
//
// Run: node scripts/test-read-budget-switch-rows-pure.cjs
const assert = require('node:assert/strict')
const { attachSwitchRows } = require('./read-budget/switches.cjs')

function fakeWorld() {
  const flags = new Map()
  const world = {
    db: {
      prepare(sql) {
        const insert = /INSERT OR REPLACE INTO system_flags/.test(sql)
        const remove = /DELETE FROM system_flags/.test(sql)
        return {
          bind(value) { return { run: async () => { assert.ok(insert, 'only the row writer binds'); flags.set('read_switches', value) } } },
          run: async () => { assert.ok(remove, 'only the row remover runs bare'); flags.delete('read_switches') },
        }
      },
    },
  }
  attachSwitchRows(world)
  const stored = () => (flags.has('read_switches') ? JSON.parse(flags.get('read_switches')) : null)
  return { world, stored }
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  await check('the pass boots with its switches; a shape adds its own and the pass\'s are still stored', async () => {
    const { world, stored } = fakeWorld()
    await world.setSwitches({ call_counting: 'on' })
    assert.deepEqual(stored().switches, { call_counting: 'on' })
    await world.addSwitches(['ic_simple', 'ic_fix_stock'])
    assert.deepEqual(stored().switches, { call_counting: 'on', ic_simple: 'on', ic_fix_stock: 'on' }, 'the shape\'s request meets its own switches AND the pass\'s')
    assert.equal(stored().epoch, 1)
  })

  await check('after the shape the pass\'s switches are back, exactly, and the shape\'s are gone', async () => {
    const { world, stored } = fakeWorld()
    await world.setSwitches({ report_atomic: 'on', report_atomic_long: 'on', expense_reads: 'on' })
    await world.addSwitches(['ic_simple'])
    await world.restoreSwitches()
    assert.deepEqual(stored().switches, { report_atomic: 'on', report_atomic_long: 'on', expense_reads: 'on' })
    await world.addSwitches(['ic_simple']); await world.restoreSwitches()
    assert.deepEqual(stored().switches, { report_atomic: 'on', report_atomic_long: 'on', expense_reads: 'on' }, 'a second shape starts from the same place')
  })

  await check('a pass with no switches ends with no row at all, as it booted', async () => {
    const { world, stored } = fakeWorld()
    assert.equal(stored(), null)
    await world.addSwitches(['ic_simple'])
    assert.deepEqual(stored().switches, { ic_simple: 'on' })
    await world.restoreSwitches()
    assert.equal(stored(), null)
  })

  await check('a shape that names a switch the pass already has does not change the pass\'s state: restore is a no-op in effect', async () => {
    const { world, stored } = fakeWorld()
    await world.setSwitches({ ic_simple: 'on', call_counting: 'on' })
    await world.addSwitches(['ic_simple'])
    await world.restoreSwitches()
    assert.deepEqual(stored().switches, { ic_simple: 'on', call_counting: 'on' })
  })

  await check('setting the pass\'s switches again (a test that flips the whole pass) moves what a shape returns to', async () => {
    const { world, stored } = fakeWorld()
    await world.setSwitches({ call_counting: 'on' })
    await world.setSwitches({ call_counting: 'off' })
    await world.addSwitches(['ic_simple']); await world.restoreSwitches()
    assert.deepEqual(stored().switches, { call_counting: 'off' })
  })

  // POSITIVE CONTROL: the Inventory Check harness as it was, replace-then-delete, loses the pass's switches. The checks above fail on it.
  await check('control: replace-then-delete (the lane\'s own harness before compose) drops the pass\'s switches', async () => {
    const { world, stored } = fakeWorld()
    await world.setSwitches({ call_counting: 'on' })
    await world.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)").bind(JSON.stringify({ epoch: 1, switches: { ic_simple: 'on' } })).run()
    await world.db.prepare("DELETE FROM system_flags WHERE key = 'read_switches'").run()
    assert.equal(stored(), null, 'call_counting is gone for every later shape')
  })

  console.log(`${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
