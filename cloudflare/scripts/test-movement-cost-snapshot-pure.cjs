const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.join(__dirname, '..')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-cost-'))
execSync(`npx tsc "${path.join(root, 'src/lib/movementCostSnapshot.ts')}" --outDir "${out}" --module commonjs --target es2022 --moduleResolution node --skipLibCheck`, { cwd: root })
const { resolveMovementCostSnapshot } = require(path.join(out, 'movementCostSnapshot.js'))

const UNKNOWN = { unitCostUsd: null, unitCostKhr: null, totalCostUsd: null, totalCostKhr: null }

assert.deepEqual(resolveMovementCostSnapshot({ quantity: 4, components: [{ quantity: 4, unitCostUsd: 0, unitCostKhr: 0 }] }), {
  unitCostUsd: 0, unitCostKhr: 0, totalCostUsd: 0, totalCostKhr: 0,
}, 'explicit zero is preserved instead of treated as missing')

// The catalog price a caller used to hand over as `fallbackUnitCost*` must not price anything: a unit with no
// recorded cost of its own is unknown, not today's catalog price. A build that still honoured the fallback fails here.
assert.deepEqual(resolveMovementCostSnapshot({ quantity: 4, fallbackUnitCostUsd: 9, fallbackUnitCostKhr: 36000 }), UNKNOWN,
  'a movement no lot covers is unknown even when a catalog price is passed')
assert.deepEqual(resolveMovementCostSnapshot({ quantity: 4, components: [{ quantity: 4, unitCostUsd: null }], fallbackUnitCostUsd: 9, fallbackUnitCostKhr: 36000 }), UNKNOWN,
  'a lot with no recorded cost is unknown, not the catalog price')
assert.deepEqual(resolveMovementCostSnapshot({ quantity: 4, components: [{ quantity: 4, unitCostUsd: 0 }], fallbackUnitCostUsd: 9 }),
  { unitCostUsd: 0, unitCostKhr: null, totalCostUsd: 0, totalCostKhr: null },
  'a recorded $0 lot stays $0 beside a catalog price of 9 (control: kept both before and after)')

// Partial coverage is unknown, never a blend of the known part with a substitute.
assert.deepEqual(resolveMovementCostSnapshot({
  quantity: 5,
  components: [{ quantity: 2, unitCostUsd: 4 }, { quantity: 2, unitCostUsd: 7 }, { quantity: 1, unitCostUsd: null }],
  fallbackUnitCostUsd: 10,
  fallbackUnitCostKhr: 40000,
}), UNKNOWN, 'lots {4, 7, unknown} are unknown, not a blend with the catalog price')
assert.deepEqual(resolveMovementCostSnapshot({
  quantity: 5, components: [{ quantity: 2, unitCostUsd: 4 }, { quantity: 1, unitCostUsd: 7 }], fallbackUnitCostUsd: 10,
}), UNKNOWN, 'units no lot covers make the whole movement unknown')

assert.deepEqual(resolveMovementCostSnapshot({
  quantity: 5,
  components: [{ quantity: 2, unitCostUsd: 4 }, { quantity: 2, unitCostUsd: 7 }, { quantity: 1, unitCostUsd: 7 }],
}), { unitCostUsd: 5.8, unitCostKhr: null, totalCostUsd: 29, totalCostKhr: null },
'fully recorded lot costs are quantity weighted; a currency no lot states stays unknown')

assert.deepEqual(resolveMovementCostSnapshot({
  quantity: 5,
  components: [{ quantity: 3, unitCostUsd: 2, unitCostKhr: 8000 }, { quantity: 2, unitCostUsd: 2, unitCostKhr: null }],
}), { unitCostUsd: 2, unitCostKhr: null, totalCostUsd: 10, totalCostKhr: null },
'each currency resolves on its own: USD known, KHR unknown when one lot has none')

assert.deepEqual(resolveMovementCostSnapshot({
  quantity: 3, components: [{ quantity: 3, unitCostUsd: 4 }, { quantity: 0, unitCostUsd: null }],
}), { unitCostUsd: 4, unitCostKhr: null, totalCostUsd: 12, totalCostKhr: null }, 'an empty component with no cost does not make the movement unknown')

assert.deepEqual(resolveMovementCostSnapshot({ quantity: 2 }), UNKNOWN, 'an unsupported currency remains unknown instead of being invented')

for (const invalid of [
  { quantity: Number.NaN },
  { quantity: Number.POSITIVE_INFINITY },
  { quantity: 1, components: [{ quantity: Number.NaN, unitCostUsd: 1 }] },
  { quantity: 1, components: [{ quantity: -1, unitCostUsd: 1 }] },
  { quantity: 1, components: [{ quantity: 1, unitCostUsd: -1 }] },
  { quantity: 1, components: [{ quantity: 1, unitCostUsd: Number.POSITIVE_INFINITY }] },
  { quantity: 1, components: [{ quantity: 1.01, unitCostUsd: 1 }] },
  { quantity: 1, components: [{ quantity: 1, unitCostUsd: 1e308 }] },
  { quantity: 1e308, components: [{ quantity: 1e308, unitCostUsd: 4 }] },
]) {
  assert.throws(() => resolveMovementCostSnapshot(invalid), RangeError)
}

console.log('PASS movement cost snapshot explicit-zero, no-catalog-substitution, unknown-propagation, weighted-lot, finite, and coverage semantics')
