import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(here, '..')
const REPO = path.resolve(FRONTEND, '..')
const GENERATOR = path.join(REPO, 'ops', 'scripts', 'licenses', 'generate-third-party-notices.mjs')
const NOTICES = path.join(FRONTEND, 'public', 'THIRD_PARTY_NOTICES.txt')

type Run = { status: number | null; stdout: string; stderr: string }
function run(root: string | null, ...flags: string[]): Run {
  const args = [GENERATOR, ...(root ? ['--root', root] : []), ...flags]
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}

type Dep = { name: string; version?: string; license?: string; files?: Record<string, string>; dev?: boolean; optional?: boolean; installed?: boolean; installedVersion?: string }
const LICENSE_ONE = 'Copyright (c) Alpha Authors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy.'

function writeFixture(root: string, deps: { frontend?: Dep[]; cloudflare?: Dep[] }): void {
  for (const workspace of ['frontend', 'cloudflare'] as const) {
    const list = deps[workspace] || []
    const packages: Record<string, unknown> = { '': { name: workspace } }
    for (const dep of list) {
      const version = dep.version || '1.0.0'
      packages[`node_modules/${dep.name}`] = {
        version,
        license: dep.license ?? 'MIT',
        ...(dep.dev ? { dev: true } : {}),
        ...(dep.optional ? { optional: true } : {}),
      }
      if (dep.installed === false) continue
      const dir = path.join(root, workspace, 'node_modules', ...dep.name.split('/'))
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: dep.name, version: dep.installedVersion || version }))
      for (const [file, text] of Object.entries(dep.files ?? { LICENSE: LICENSE_ONE })) fs.writeFileSync(path.join(dir, file), text)
    }
    fs.mkdirSync(path.join(root, workspace, 'public'), { recursive: true })
    fs.writeFileSync(path.join(root, workspace, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }))
  }
}

function withFixture(deps: Parameters<typeof writeFixture>[1], body: (root: string, output: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-'))
  try {
    writeFixture(root, deps)
    body(root, path.join(root, 'frontend', 'public', 'THIRD_PARTY_NOTICES.txt'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const failures: string[] = []
function runCase(name: string, body: () => void): void {
  try {
    body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error).split('\n').join('\n  ')}`)
  }
}

runCase('the committed notices match the locked production packages of both lockfiles (--check on the real repo)', () => {
  const result = run(null, '--check')
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

runCase('every production package in either lockfile is named in the shipped file, and dev tooling is not', () => {
  const committed = fs.readFileSync(NOTICES, 'utf8')
  const production: string[] = []
  const development: string[] = []
  for (const workspace of ['frontend', 'cloudflare']) {
    const lock = JSON.parse(fs.readFileSync(path.join(REPO, workspace, 'package-lock.json'), 'utf8'))
    for (const [key, meta] of Object.entries<any>(lock.packages)) {
      if (!key) continue
      const id = `${key.replace(/^.*node_modules\//, '')}@${meta.version}`
      if (meta.dev || meta.devOptional) development.push(id)
      else production.push(id)
    }
  }
  assert.ok(production.length >= 50, `only ${production.length} production packages found`)
  for (const id of production) assert.ok(committed.includes(`${id} (`), `${id} is missing from THIRD_PARTY_NOTICES.txt`)
  for (const id of development.filter((entry) => !production.includes(entry)).slice(0, 40)) assert.ok(!committed.includes(`${id} (`), `${id} is dev tooling but is listed`)
})

runCase('the file carries the notices the audit named: Noto Sans Khmer OFL, Lucide ISC, Dexie NOTICE, ZXing jai-imageio, hono, bcryptjs', () => {
  const committed = fs.readFileSync(NOTICES, 'utf8')
  assert.match(committed, /@fontsource\/noto-sans-khmer@[\d.]+ \(OFL-1\.1\)/)
  assert.match(committed, /SIL OPEN FONT LICENSE Version 1\.1/)
  assert.match(committed, /Copyright 2022 The Noto Project Authors/)
  assert.match(committed, /lucide-react@[\d.]+ \(ISC\)/)
  assert.match(committed, /dexie@[\d.]+ \(Apache-2\.0\)/)
  assert.match(committed, /Sun Microsystems/)
  assert.match(committed, /hono@[\d.]+ \(MIT\)/)
  assert.match(committed, /bcryptjs@[\d.]+ \(BSD-3-Clause\)/)
  assert.doesNotMatch(committed, /ffmpeg/i)
  assert.ok(!committed.includes('\r'), 'the generated file is written with LF endings')
})

runCase('frontend/package.json exposes licenses:notices and licenses:check, both through the one generator', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'package.json'), 'utf8')).scripts
  assert.equal(scripts['licenses:notices'], 'node ../ops/scripts/licenses/generate-third-party-notices.mjs')
  assert.equal(scripts['licenses:check'], 'node ../ops/scripts/licenses/generate-third-party-notices.mjs --check')
})

runCase('generating then checking is green; dev-only packages are left out; identical licence texts are written once', () => {
  withFixture({
    frontend: [{ name: 'alpha' }, { name: 'alpha-twin' }, { name: 'tooling', dev: true, files: { LICENSE: 'TOOLING ONLY TEXT' } }],
    cloudflare: [{ name: '@scope/beta', files: { LICENSE: 'Beta licence text' } }],
  }, (root, output) => {
    const written = run(root)
    assert.equal(written.status, 0, written.stderr)
    const text = fs.readFileSync(output, 'utf8')
    assert.ok(text.includes('alpha@1.0.0 (MIT)') && text.includes('alpha-twin@1.0.0 (MIT)') && text.includes('@scope/beta@1.0.0 (MIT)'))
    assert.ok(!text.includes('TOOLING ONLY TEXT') && !text.includes('tooling@'))
    assert.equal(text.split('Permission is hereby granted').length - 1, 1, 'two packages with the same licence text print it once')
    assert.match(text, /3 packages, 2 distinct licence texts\./)
    assert.equal(run(root, '--check').status, 0)
  })
})

runCase('a Windows checkout of the committed file (CRLF) still passes --check', () => {
  withFixture({ frontend: [{ name: 'alpha' }] }, (root, output) => {
    assert.equal(run(root).status, 0)
    fs.writeFileSync(output, fs.readFileSync(output, 'utf8').replace(/\n/g, '\r\n'))
    assert.equal(run(root, '--check').status, 0)
  })
})

runCase('a dependency change without regenerated notices fails --check: a new package, a bumped version and an edited licence text', () => {
  withFixture({ frontend: [{ name: 'alpha' }] }, (root, output) => {
    assert.equal(run(root).status, 0)
    const committed = fs.readFileSync(output, 'utf8')

    writeFixture(root, { frontend: [{ name: 'alpha' }, { name: 'gamma' }] })
    const added = run(root, '--check')
    assert.equal(added.status, 1)
    assert.match(added.stderr, /out of date/)

    writeFixture(root, { frontend: [{ name: 'alpha', version: '1.0.1' }] })
    const bumped = run(root, '--check')
    assert.equal(bumped.status, 1)
    assert.match(bumped.stderr, /out of date/)

    writeFixture(root, { frontend: [{ name: 'alpha', files: { LICENSE: 'Copyright (c) Someone Else' } }] })
    const reworded = run(root, '--check')
    assert.equal(reworded.status, 1)
    assert.match(reworded.stderr, /out of date/)

    assert.equal(fs.readFileSync(output, 'utf8'), committed, '--check never rewrites the file')
    assert.equal(run(root).status, 0)
    assert.equal(run(root, '--check').status, 0)
  })
})

runCase('a new dev-only dependency does not change the notices', () => {
  withFixture({ frontend: [{ name: 'alpha' }] }, (root) => {
    assert.equal(run(root).status, 0)
    writeFixture(root, { frontend: [{ name: 'alpha' }, { name: 'vite-like', dev: true, license: 'GPL-3.0-only' }] })
    assert.equal(run(root, '--check').status, 0)
  })
})

runCase('a production package outside the allow list stops the generator and --check, and nothing is written', () => {
  withFixture({ frontend: [{ name: 'alpha' }, { name: 'copyleft', license: 'GPL-3.0-only' }, { name: 'nolicence', license: '' }] }, (root, output) => {
    const generated = run(root)
    assert.equal(generated.status, 1)
    assert.match(generated.stderr, /copyleft@1\.0\.0: licence "GPL-3\.0-only" is not on the allow list/)
    assert.match(generated.stderr, /nolicence@1\.0\.0: licence "MISSING" is not on the allow list/)
    assert.equal(fs.existsSync(output), false)
    assert.equal(run(root, '--check').status, 1)
  })
})

runCase('@ffmpeg/core and @ffmpeg/ffmpeg are refused even though they declare MIT', () => {
  withFixture({ frontend: [{ name: '@ffmpeg/core', license: 'MIT' }], cloudflare: [{ name: '@ffmpeg/ffmpeg', license: 'MIT' }] }, (root) => {
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /@ffmpeg\/core@1\.0\.0: blocked/)
    assert.match(result.stderr, /@ffmpeg\/ffmpeg@1\.0\.0: blocked/)
  })
})

runCase('notices are only read from an install that matches the lockfile', () => {
  withFixture({ frontend: [{ name: 'alpha', installedVersion: '0.9.0' }, { name: 'missing', installed: false }, { name: 'extra', optional: true, installed: false }] }, (root) => {
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /alpha@1\.0\.0: frontend\/node_modules\/alpha has 0\.9\.0 installed/)
    assert.match(result.stderr, /missing@1\.0\.0: frontend\/node_modules\/missing is not installed/)
    assert.doesNotMatch(result.stderr, /extra@/, 'an optional package that is not installed is skipped')
  })
})

runCase('a package gets every licence and notice file, in a fixed order, and code files named license.js are ignored; no file falls back to the declared id', () => {
  withFixture({
    frontend: [
      { name: 'multi', files: { NOTICE: 'Notice text B', LICENSE: 'Licence text A', 'license.js': 'module.exports = 1', 'README.md': 'readme' } },
      { name: 'bare', license: 'ISC', files: { 'README.md': 'readme only' } },
    ],
  }, (root, output) => {
    assert.equal(run(root).status, 0)
    const text = fs.readFileSync(output, 'utf8')
    assert.ok(text.indexOf('Licence text A') > -1 && text.indexOf('Licence text A') < text.indexOf('Notice text B'))
    assert.ok(!text.includes('module.exports') && !text.includes('readme only'))
    assert.ok(text.includes('ISC (declared in package.json; the package ships no licence file)'))
  })
})

if (failures.length) {
  console.log(`\n${failures.length} case(s) failed`)
  process.exit(1)
}
console.log('PASS third-party notices: generated from both lockfiles, current, and a dependency change without regenerating them fails')
