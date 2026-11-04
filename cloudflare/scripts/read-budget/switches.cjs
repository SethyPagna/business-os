'use strict'
// The read-switch row of a read-budget world: one document under system_flags 'read_switches', in the shape lib/readSwitches.ts reads.
//
// A pass runs with ONE set of switches stored for its whole run (`bootWorld({ switches })`: the sales-report and expense switches for the GET passes,
// call_counting for the write pass), because a budget is only a budget for the state the Free plan is meant to run in. A shape that needs more switches
// for its own request (the Inventory Check shapes name ic_simple / ic_fix_stock) adds them around that request and puts the pass's switches back
// afterwards: replacing the row and then deleting it would silently drop the pass's own switches for every shape that follows.
function attachSwitchRows(world) {
  const store = (map) => world.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)")
    .bind(JSON.stringify({ epoch: 1, switches: map })).run()
  // The pass's own switches. Setting them (at boot, or a test that flips the whole pass) is what restoreSwitches returns to.
  world.passSwitches = {}
  world.setSwitches = async (map) => {
    world.passSwitches = { ...map }
    await store(map)
  }
  // The pass's switches plus these names ON, for one request; `without` takes some of the pass's own away for that request (a shape that measures the
  // state before that switch is turned on).
  world.addSwitches = (names, { without = [] } = {}) => {
    const next = { ...world.passSwitches }
    for (const name of without) delete next[name]
    return store({ ...next, ...Object.fromEntries(names.map((name) => [name, 'on'])) })
  }
  // Back to the pass's switches (no row at all when the pass has none, as it booted).
  world.restoreSwitches = () => (Object.keys(world.passSwitches).length
    ? store(world.passSwitches)
    : world.db.prepare("DELETE FROM system_flags WHERE key = 'read_switches'").run())
  return world
}

module.exports = { attachSwitchRows }
