import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformWithEsbuild } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')
const TYPESCRIPT_SOURCE_PATTERN = /\.(ts|tsx)$/
const JAVASCRIPT_SOURCE_PATTERN = /\.(js|jsx|mjs|cjs)$/

interface SourceScan {
  typedFiles: string[]
  forbiddenJsFiles: string[]
}

async function listSourceFiles(dir: string): Promise<SourceScan> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested: SourceScan[] = await Promise.all(entries.map(async (entry): Promise<SourceScan> => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    if (TYPESCRIPT_SOURCE_PATTERN.test(entry.name)) {
      return { typedFiles: [fullPath], forbiddenJsFiles: [] }
    }
    if (JAVASCRIPT_SOURCE_PATTERN.test(entry.name)) {
      return { typedFiles: [], forbiddenJsFiles: [fullPath] }
    }
    return { typedFiles: [], forbiddenJsFiles: [] }
  }))
  return nested.reduce<SourceScan>((scan, item) => {
    scan.typedFiles.push(...item.typedFiles)
    scan.forbiddenJsFiles.push(...item.forbiddenJsFiles)
    return scan
  }, { typedFiles: [], forbiddenJsFiles: [] })
}

const { typedFiles: files, forbiddenJsFiles } = await listSourceFiles(srcDir)
assert.ok(files.length > 0, 'Expected source files to check')
assert.deepEqual(
  forbiddenJsFiles.map((file) => path.relative(root, file)),
  [],
  'frontend/src should stay fully TypeScript; keep runtime JS only in approved config/public-runtime locations',
)

const failures: string[] = []
const nativeSelectFiles: string[] = []
for (const file of files) {
  try {
    const source = await readFile(file, 'utf8')
    if (file.includes(`${path.sep}src${path.sep}components${path.sep}`) && /<select[\s>]/.test(source)) {
      nativeSelectFiles.push(path.relative(root, file))
    }
    const loader = file.endsWith('.tsx') ? 'tsx' : 'ts'
    await transformWithEsbuild(source, file, { loader, jsx: 'automatic' })
  } catch (error) {
    failures.push(`${path.relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

assert.deepEqual(
  nativeSelectFiles,
  [],
  'frontend components should use AppSelect for rounded, keyboard-accessible filter and page-size menus instead of native square selects',
)
assert.deepEqual(failures, [])
console.log(`PASS TypeScript source syntax check parsed ${files.length} source files`)
