const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const COMPLETED_CUTOVER_REF = '2bb192bcbd5ff9f21a2e8910b8a84ad936c7485c'
const cwd = path.resolve(__dirname, '../../..')
const cache = new Map()
const git = (args, options = {}) => execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...options })

function readFiles(files) {
  const missing = files.filter(file => !cache.has(file))
  if (missing.length) {
    const result = git(['cat-file', '--batch'], { input: missing.map(file => `${COMPLETED_CUTOVER_REF}:${file}\n`).join('') })
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
    const files = git(['ls-tree', '-r', '--name-only', COMPLETED_CUTOVER_REF, '--', 'cloudflare/migrations'], { encoding: 'utf8' })
      .trim().split('\n').filter(file => file.endsWith('.sql')).sort()
    assert.equal(files.length, 201)
    const sql = readFiles(files)
    migrations = Object.freeze(files.map((file, index) => Object.freeze({ name: path.posix.basename(file), sql: sql[index] })))
  }
  return migrations
}

module.exports = { COMPLETED_CUTOVER_REF, readSource, migrationEntries }
