// npm's postbuild lifecycle runs this only after a successful Vite build.
// This certifies emitted static dependency boundaries, not browser rendering,
// dynamic imports, service-worker upgrades or every possible blank-page cause.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const frontend = fileURLToPath(new URL('../../../frontend/', import.meta.url))
const validator = fileURLToPath(new URL('../../../frontend/tests/chunkBoundaryPolicy.test.ts', import.meta.url))
const result = spawnSync(process.execPath, [validator, '--bundle'], {
  cwd: frontend,
  stdio: 'inherit',
})
if (result.error || result.signal) {
  console.error('Built startup dependency verification could not complete:', result.error || result.signal)
}
process.exitCode = result.status ?? 1
