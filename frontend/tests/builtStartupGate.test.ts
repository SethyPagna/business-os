import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = fileURLToPath(new URL('..', import.meta.url))
const repository = path.dirname(frontend)
const pkg = JSON.parse(fs.readFileSync(path.join(frontend, 'package.json'), 'utf8'))
const command = 'node ../ops/scripts/frontend/verify-built-startup.mjs'
assert.equal(pkg.scripts.postbuild, command, 'normal npm build must verify the newly emitted bundle')
assert.equal(pkg.scripts['verify:built-startup'], command)

// Execute the existing validator unchanged. Its source/config checks use the
// real repository; its emitted graph is disposable and independent of dist.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-built-startup-'))
const fixtureFrontend = path.join(fixture, 'frontend')
const links: string[] = []
try {
  fs.mkdirSync(path.join(fixtureFrontend, 'tests'), { recursive: true })
  fs.mkdirSync(path.join(fixture, 'ops/scripts/frontend'), { recursive: true })
  for (const name of ['src', 'build', 'node_modules']) {
    const link = path.join(fixtureFrontend, name)
    fs.symlinkSync(path.join(frontend, name), link, process.platform === 'win32' ? 'junction' : 'dir')
    links.push(link)
  }
  fs.copyFileSync(path.join(frontend, 'vite.config.ts'), path.join(fixtureFrontend, 'vite.config.ts'))
  fs.copyFileSync(path.join(frontend, 'tests/chunkBoundaryPolicy.test.ts'), path.join(fixtureFrontend, 'tests/chunkBoundaryPolicy.test.ts'))
  const script = path.join(fixture, 'ops/scripts/frontend/verify-built-startup.mjs')
  fs.copyFileSync(path.join(repository, 'ops/scripts/frontend/verify-built-startup.mjs'), script)
  fs.writeFileSync(path.join(fixtureFrontend, 'package.json'), JSON.stringify({ type: 'module', scripts: {
    build: 'node -e "process.exit(0)"', postbuild: pkg.scripts.postbuild,
  } }))
  const verify = () => spawnSync(process.execPath, [script], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 30_000 })
  const missing = verify()
  assert.notEqual(missing.status, 0, 'missing dist must fail, never silently skip')
  assert.match(missing.stdout + missing.stderr, /ENOENT/)
  const assets = path.join(fixtureFrontend, 'dist/assets')
  fs.mkdirSync(assets, { recursive: true })
  for (const entry of ['index', 'auth-login', 'catalog-public', 'catalog-products', 'catalog-secondary-tabs']) {
    fs.writeFileSync(path.join(assets, `${entry}-12345678.js`), 'export const value = 1;')
  }
  fs.writeFileSync(path.join(fixtureFrontend, 'dist/index.html'), 'var preloads = {"public":["/assets/catalog-public-12345678.js"]};')
  fs.writeFileSync(path.join(assets, 'fixture.woff2'), '')
  fs.writeFileSync(path.join(assets, 'fixture.css'), [400, 500, 600].map(weight => `@font-face{font-family:Noto Sans Khmer;font-weight:${weight};src:url(/assets/fixture.woff2)}`).join('\n'))
  const valid = verify()
  assert.equal(valid.status, 0, valid.stdout + valid.stderr)
  assert.match(valid.stdout, /emitted static chunk graph: 5 chunks, zero cycles/)
  fs.writeFileSync(path.join(assets, 'cycle-a.js'), 'export { value } from "./cycle-b.js";')
  fs.writeFileSync(path.join(assets, 'cycle-b.js'), 'export { value } from "./cycle-a.js";')
  const cyclic = verify()
  assert.notEqual(cyclic.status, 0)
  assert.match(cyclic.stdout + cyclic.stderr, /static chunk cycle:/)
  // Exercise npm's actual lifecycle, not just a source assertion about wiring.
  const build = spawnSync('npm run build', { cwd: fixtureFrontend, shell: true, encoding: 'utf8', timeout: 30_000 })
  assert.notEqual(build.status, 0, 'a successful build command plus failing postbuild must fail npm build')
  assert.match(build.stdout + build.stderr, /static chunk cycle:/)
} finally {
  // Remove junctions themselves before deleting the private temporary fixture.
  for (const link of links) fs.unlinkSync(link)
  fs.rmSync(fixture, { recursive: true, force: true })
}
console.log('PASS actual emitted validator, missing-dist refusal, cycle rejection and npm postbuild failure propagation')
