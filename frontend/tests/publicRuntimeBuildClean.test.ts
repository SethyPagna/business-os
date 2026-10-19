import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const generatorPath = join(root, 'ops/scripts/frontend/build-public-runtime-scripts.ts')
const generator = readFileSync(generatorPath, 'utf8')
const sources = ['runtime-noise-guard.ts', 'theme-bootstrap.ts', 'service-worker.ts']
const outputs = ['runtime-noise-guard.js', 'theme-bootstrap.js', 'sw.js']
const temporary = mkdtempSync(join(tmpdir(), 'runtime-clean-'))
const environment = { ...process.env }
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete environment[key]

try {
  for (const eol of ['lf', 'crlf']) {
    const fixture = join(temporary, eol)
    const git = (...args: string[]) => execFileSync('git', ['-C', fixture, ...args], { encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    const write = (file: string, content: string) => {
      const target = join(fixture, file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, eol === 'crlf' ? content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : content.replace(/\r\n/g, '\n'))
    }
    const script = 'ops/scripts/frontend/build-public-runtime-scripts.ts'
    write(script, generator)
    write('.gitignore', 'frontend/node_modules/\n')
    for (const name of sources) write('frontend/src/public-runtime/' + name, readFileSync(join(root, 'frontend/src/public-runtime', name), 'utf8'))
    for (const name of outputs) write('frontend/public/' + name, readFileSync(join(root, 'frontend/public', name), 'utf8'))
    mkdirSync(join(fixture, 'frontend/node_modules'), { recursive: true })
    symlinkSync(realpathSync(join(root, 'frontend/node_modules/typescript')), join(fixture, 'frontend/node_modules/typescript'), process.platform === 'win32' ? 'junction' : 'dir')
    git('init', '--quiet')
    git('config', 'core.autocrlf', eol === 'crlf' ? 'true' : 'false')
    git('config', 'core.hooksPath', join(fixture, '.git/empty-hooks'))
    git('add', '--', '.gitignore', script, ...sources.map(name => 'frontend/src/public-runtime/' + name), ...outputs.map(name => 'frontend/public/' + name))
    git('-c', 'user.name=Runtime fixture', '-c', 'user.email=runtime@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', 'Fixture')
    assert.equal(git('status', '--porcelain=v1'), '', eol + ' baseline is clean')
    const snapshot = () => outputs.map(name => {
      const file = join(fixture, 'frontend/public', name)
      return { bytes: readFileSync(file), modified: statSync(file, { bigint: true }).mtimeNs }
    })
    const run = (...args: string[]) => spawnSync(process.execPath, [join(fixture, script), ...args], { cwd: fixture, encoding: 'utf8', env: environment })
    const before = snapshot()
    assert.equal(run().status, 0)
    assert.deepEqual(snapshot(), before, eol + ' build preserves matching bytes and modification times')
    assert.equal(git('status', '--porcelain=v1'), '', eol + ' build leaves the checkout clean')
    assert.equal(run('--check').status, 0)
    assert.deepEqual(snapshot(), before)

    const stale = join(fixture, 'frontend/public', outputs[0])
    writeFileSync(stale, readFileSync(stale, 'utf8') + '\nconsole.log("stale-fixture")\n')
    const staleSnapshot = snapshot()
    const refused = run('--check')
    assert.equal(refused.status, 1)
    assert.match(refused.stderr + refused.stdout, /Generated runtime is stale/)
    assert.deepEqual(snapshot(), staleSnapshot, '--check refuses without repairing tracked output')
    assert.equal(run().status, 0)
    assert.equal(readFileSync(stale, 'utf8').replace(/\r\n/g, '\n'), before[0].bytes.toString('utf8').replace(/\r\n/g, '\n'))
    assert.deepEqual(snapshot().slice(1), before.slice(1), 'repair does not rewrite other matching outputs')
    assert.equal(run('--check').status, 0)

    const missing = join(fixture, 'frontend/public', outputs[1])
    unlinkSync(missing)
    assert.equal(run('--check').status, 1)
    assert.equal(existsSync(missing), false, '--check does not recreate missing output')
    assert.equal(run().status, 0)
    assert.equal(readFileSync(missing, 'utf8').replace(/\r\n/g, '\n'), before[1].bytes.toString('utf8').replace(/\r\n/g, '\n'))
    assert.equal(run('--check').status, 0)
    console.log('PASS actual generator preserves clean ' + eol + ' checkout and repairs only stale/missing outputs')
  }
} finally {
  assert.equal(dirname(temporary), resolve(tmpdir()))
  assert.ok(temporary.startsWith(join(resolve(tmpdir()), 'runtime-clean-')))
  rmSync(temporary, { recursive: true, force: true })
}
