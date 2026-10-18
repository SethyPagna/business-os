const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')

const REPAIR_REF = '2bb192bcbd5ff9f21a2e8910b8a84ad936c7485c'
const repositoryRoot = path.resolve(__dirname, '../../..')
const trees = new Map()
const blobs = new Map()

function createArchivedRepairWorld() {
  if (!trees.has(REPAIR_REF)) {
    const tree = execFileSync('git', ['ls-tree', '-r', REPAIR_REF], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    trees.set(REPAIR_REF, new Map(tree.trim().split('\n').map(line => {
      const [metadata, file] = line.split('\t')
      return [file, metadata.split(' ')[2]]
    })))
  }
  const tree = trees.get(REPAIR_REF)
  const read = relative => {
    const normalized = path.posix.normalize(relative.replaceAll('\\', '/'))
    const object = tree.get(normalized)
    assert.ok(object, `${REPAIR_REF}:${normalized}`)
    if (!blobs.has(object)) blobs.set(object, execFileSync('git', ['cat-file', 'blob', object], { cwd: repositoryRoot, maxBuffer: 64 * 1024 * 1024 }))
    return blobs.get(object).toString('utf8')
  }
  const relativePath = file => {
    const relative = path.relative(repositoryRoot, path.resolve(file)).replaceAll('\\', '/')
    assert.ok(relative && !relative.startsWith('../') && !path.isAbsolute(relative))
    return relative
  }
  const migrations = [...tree.keys()].filter(file => file.startsWith('cloudflare/migrations/') && file.endsWith('.sql')).sort()
  assert.equal(migrations.length, 201)
  assert.ok(migrations.some(file => file.includes('/0242_')))
  assert.ok(migrations.some(file => file.includes('/0250_')))
  assert.ok(migrations.every(file => !/\/(?:024[3-9]|0258)_/.test(file)))
  const archivedFs = {
    ...fs,
    readFileSync(file, encoding) {
      const content = read(relativePath(file))
      return encoding ? content : Buffer.from(content)
    },
    readdirSync(directory) {
      const prefix = relativePath(directory) + '/'
      return [...new Set([...tree.keys()].filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length).split('/')[0]))].sort()
    },
  }
  const modules = new Map()
  const requireArchive = relative => {
    relative = path.posix.normalize(relative)
    if (modules.has(relative)) return modules.get(relative).exports
    const filename = path.join(repositoryRoot, relative)
    const externalRequire = createRequire(filename)
    const module = { exports: {} }
    modules.set(relative, module)
    const localRequire = name => {
      if (name === 'node:fs' || name === 'fs') return archivedFs
      if (name.startsWith('.')) {
        let target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), name))
        if (!path.posix.extname(target)) target += '.cjs'
        return requireArchive(target)
      }
      return externalRequire(name)
    }
    new Function('require', 'module', 'exports', '__filename', '__dirname', read(relative))(
      localRequire, module, module.exports, filename, path.dirname(filename),
    )
    return module.exports
  }
  const base = requireArchive('cloudflare/scripts/test-stock-session-atomic.cjs')
  let temporaryRoot = null
  const materialized = new Set()
  const materialize = relative => {
    if (!temporaryRoot) temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'businessos-repair-'))
    const destination = path.resolve(temporaryRoot, relative)
    assert.ok(destination.startsWith(path.resolve(temporaryRoot) + path.sep))
    if (materialized.has(relative)) return destination
    const text = read(relative)
    materialized.add(relative)
    for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      materialize(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])))
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, text)
    return destination
  }
  const cleanup = () => {
    if (!temporaryRoot) return
    const target = path.resolve(temporaryRoot)
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()))
    assert.ok(path.basename(target).startsWith('businessos-repair-'))
    fs.rmSync(target, { recursive: true, force: true })
    temporaryRoot = null
  }
  return { ref: REPAIR_REF, read, fixture: base.fixture, user: base.user, esm: relative => import(pathToFileURL(materialize(relative)).href), cleanup }
}

module.exports = { REPAIR_REF, createArchivedRepairWorld }
