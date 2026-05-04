import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformWithEsbuild } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    return /\.(jsx|js|mjs)$/.test(entry.name) ? [fullPath] : []
  }))
  return nested.flat()
}

const files = await listSourceFiles(srcDir)
assert.ok(files.some((file) => file.endsWith('.jsx')), 'Expected JSX source files to check')

const failures = []
for (const file of files) {
  try {
    const source = await readFile(file, 'utf8')
    const loader = file.endsWith('.jsx') ? 'jsx' : 'js'
    await transformWithEsbuild(source, file, { loader, jsx: 'automatic' })
  } catch (error) {
    failures.push(`${path.relative(root, file)}: ${error?.message || error}`)
  }
}

assert.deepEqual(failures, [])
console.log(`PASS JSX syntax check parsed ${files.length} source files`)
