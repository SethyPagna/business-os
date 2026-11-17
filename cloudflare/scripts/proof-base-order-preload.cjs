'use strict'
// Preload for the proof in proof-twin-order-only.cjs: `node -r ./scripts/proof-base-order-preload.cjs scripts/test-<name>-native.cjs` runs a recording test against the code with the
// intra-family ORDER BY clauses put back to their text at the base (an in-memory source patch). A recording test that is red on the current code and green here was recorded from the base.
const world = require('./read-budget/world.cjs')
const { PATCHES } = require('./proof-twin-order-only.cjs')
const boot = world.bootWorld
world.bootWorld = (options = {}) => boot({ ...options, patches: [...(options.patches || []), ...PATCHES] })
