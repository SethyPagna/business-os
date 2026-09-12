const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.join(__dirname, '..')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-cost-'))
execSync(`npx tsc "${path.join(root, 'src/lib/movementCostSnapshot.ts')}" --outDir "${out}" --module commonjs --target es2022 --moduleResolution node --skipLibCheck`, { cwd: root })
const { resolveMovementCostSnapshot } = require(path.join(out, 'movementCostSnapshot.js'))

assert.deepEqual(resolveMovementCostSnapshot({ quantity: 4, components: [{ quantity: 4, unitCostUsd: 0, unitCostKhr: 0 }], fallbackUnitCostUsd: 9, fallbackUnitCostKhr: 36000 }), {
  unitCostUsd: 0, unitCostKhr: 0, totalCostUsd: 0, totalCostKhr: 0,
}, 'explicit zero is preserved instead of treated as missing')

assert.deepEqual(resolveMovementCostSnapshot({ quantity: 4, fallbackUnitCostUsd: 9, fallbackUnitCostKhr: 36000 }), {
  unitCostUsd: 9, unitCostKhr: 36000, totalCostUsd: 36, totalCostKhr: 144000,
}, 'blank action cost uses the product snapshot captured by the caller')

assert.deepEqual(resolveMovementCostSnapshot({
  quantity: 5,
  components: [{ quantity: 2, unitCostUsd: 4 }, { quantity: 2, unitCostUsd: 7 }, { quantity: 1, unitCostUsd: null }],
  fallbackUnitCostUsd: 10,
  fallbackUnitCostKhr: 40000,
}), {
  unitCostUsd: 6.4, unitCostKhr: 40000, totalCostUsd: 32, totalCostKhr: 200000,
}, 'lot costs are quantity weighted and missing lot currencies use the captured product fallback')

assert.deepEqual(resolveMovementCostSnapshot({ quantity: 2 }), {
  unitCostUsd: null, unitCostKhr: null, totalCostUsd: null, totalCostKhr: null,
}, 'an unsupported currency remains unknown instead of being invented')

console.log('PASS movement cost snapshot explicit-zero, fallback, weighted-lot, and unknown semantics')
