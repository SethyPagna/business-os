const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const COMPLETED_CUTOVER_REF = '2bb192bcbd5ff9f21a2e8910b8a84ad936c7485c'
const COST_PROVENANCE_REF = 'd5f0c7a13472777b2dea9bdfa34c66b63fdf9d29'
const cwd = path.resolve(__dirname, '../../..')
const git = (args, options = {}) => execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...options })

function archivedWorld(ref) {
  assert.ok([COMPLETED_CUTOVER_REF, COST_PROVENANCE_REF].includes(ref))
  const cache = new Map()
  function readFiles(files) {
    const missing = files.filter(file => !cache.has(file))
    if (missing.length) {
      const result = git(['cat-file', '--batch'], { input: missing.map(file => `${ref}:${file}\n`).join('') })
      let offset = 0
      for (const file of missing) {
        const end = result.indexOf(10, offset)
        const header = result.subarray(offset, end).toString('utf8')
        const match = /^[a-f0-9]{40} blob (\d+)$/.exec(header)
        assert.ok(match, `Missing archived cutover blob: ${file}`)
        const size = Number(match[1])
        offset = end + 1
        assert.equal(result[offset + size], 10)
        cache.set(file, result.subarray(offset, offset + size).toString('utf8'))
        offset += size + 1
      }
      assert.equal(offset, result.length)
    }
    return files.map(file => cache.get(file))
  }

  function readSource(relative) {
    assert.ok(!path.posix.isAbsolute(relative) && !relative.split('/').includes('..'))
    return readFiles([`cloudflare/src/${relative}`])[0]
  }

  let migrations
  function migrationEntries() {
    if (!migrations) {
      const files = git(['ls-tree', '-r', '--name-only', ref, '--', 'cloudflare/migrations'], { encoding: 'utf8' })
        .trim().split('\n').filter(file => file.endsWith('.sql')).sort()
      assert.equal(files.length, 201)
      const sql = readFiles(files)
      migrations = Object.freeze(files.map((file, index) => Object.freeze({ name: path.posix.basename(file), sql: sql[index] })))
    }
    return migrations
  }
  function esbuildPlugin(sourceRoot) {
    const withinSource = file => {
      const relative = path.relative(sourceRoot, file)
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    }
    return { name: 'archived-cutover-source', setup(build) {
      build.onResolve({ filter: /^\./ }, args => {
        if (withinSource(args.importer)) assert.ok(withinSource(path.resolve(args.resolveDir, args.path)), 'Archived application import escaped src')
      })
      build.onLoad({ filter: /.*/ }, args => {
        if (!withinSource(args.path)) return
        assert.equal(path.extname(args.path), '.ts')
        return { contents: readSource(path.relative(sourceRoot, args.path).split(path.sep).join('/')), loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    } }
  }
  return { ref, readSource, migrationEntries, esbuildPlugin }
}

module.exports = { COMPLETED_CUTOVER_REF, COST_PROVENANCE_REF, archivedWorld, ...archivedWorld(COMPLETED_CUTOVER_REF) }
