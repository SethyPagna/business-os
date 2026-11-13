// Shop-device mutants, shard 2 of 4. The checks, the mutant list and the runner are in test-shop-device-pure.cjs (shard 1); splitting keeps each file under the release sweep's per-file time limit.
process.argv.push('--shard=2/4')
require('./test-shop-device-pure.cjs')
