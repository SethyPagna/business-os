'use strict'

type FsModule = typeof import('fs')
type PathModule = typeof import('path')
type Dirent = import('fs').Dirent
type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null
type FileWalkOptions = {
  excludeDirs?: Set<string>
  extensions?: Set<string> | null
}
type RootFileOptions = {
  extensions?: Set<string> | null
  excludedFiles?: Set<string>
}
type CollectedFilesAndFolders = {
  files: string[]
  folders: string[]
}
type FsUtilsExports = {
  toPosix: typeof toPosix
  resolveProjectRoot: typeof resolveProjectRoot
  relFrom: typeof relFrom
  readUtf8: typeof readUtf8
  readJson: typeof readJson
  readUtf8Async: typeof readUtf8Async
  readJsonAsync: typeof readJsonAsync
  lineCount: typeof lineCount
  pathExists: typeof pathExists
  mapLimit: typeof mapLimit
  walkFilesRecursive: typeof walkFilesRecursive
  collectFilesAndFolders: typeof collectFilesAndFolders
  collectRootFiles: typeof collectRootFiles
  isProbablyText: typeof isProbablyText
}

declare const require: (moduleName: 'fs' | 'path') => FsModule | PathModule
declare const __dirname: string
declare const process: { cwd: () => string }
declare const Buffer: { alloc: (size: number) => Buffer }
declare const module: { exports: FsUtilsExports }

const fs = require('fs') as FsModule
const path = require('path') as PathModule

function toPosix(value: unknown): string {
  return String(value || '').replace(/\\/g, '/')
}

function resolveProjectRoot(startDir = __dirname): string {
  let current = path.resolve(startDir)
  while (true) {
    const hasProjectShape =
      fs.existsSync(path.join(current, 'backend')) &&
      fs.existsSync(path.join(current, 'frontend')) &&
      fs.existsSync(path.join(current, 'ops'))
    if (hasProjectShape) return current

    const parent = path.dirname(current)
    if (parent === current) return process.cwd()
    current = parent
  }
}

function relFrom(rootDir: string, absPath: string): string {
  return toPosix(path.relative(rootDir, absPath))
}

function readUtf8(filePath: string, fallback = ''): string {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch (_) {
    return fallback
  }
}

function readJson<T = JsonValue>(filePath: string, fallback = {} as T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (_) {
    return fallback
  }
}

async function readUtf8Async(filePath: string, fallback = ''): Promise<string> {
  try {
    return await fs.promises.readFile(filePath, 'utf8')
  } catch (_) {
    return fallback
  }
}

async function readJsonAsync<T = JsonValue>(filePath: string, fallback = {} as T): Promise<T> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8'))
  } catch (_) {
    return fallback
  }
}

function lineCount(text: unknown): number {
  if (!text) return 0
  return String(text).split(/\r?\n/).length
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath)
    return true
  } catch (_) {
    return false
  }
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R> | R): Promise<R[]> {
  const output = new Array<R>(items.length)
  if (!items.length) return output
  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      output[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }
  const workers = Array.from({ length: workerCount }, worker)
  await Promise.all(workers)
  return output
}

function shouldSkipDirectory(entryName: unknown, excludeDirs: Set<string>): boolean {
  return excludeDirs.has(String(entryName || '').toLowerCase())
}

function walkFilesRecursive(startDir: string, options: FileWalkOptions = {}): string[] {
  const {
    excludeDirs = new Set(['node_modules', 'dist', '.git', '.pm2', 'release']),
    extensions = null,
  } = options
  const out: string[] = []
  if (!fs.existsSync(startDir)) return out
  const stack = [startDir]
  while (stack.length) {
    const current = stack.pop()
    if (!current) continue
    const entries = fs.readdirSync(current, { withFileTypes: true })
    entries.forEach((entry: Dirent) => {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name, excludeDirs)) stack.push(abs)
        return
      }
      if (extensions instanceof Set) {
        const ext = path.extname(entry.name).toLowerCase()
        if (!extensions.has(ext)) return
      }
      out.push(abs)
    })
  }
  return out
}

function collectFilesAndFolders(startDir: string, options: FileWalkOptions = {}): CollectedFilesAndFolders {
  const {
    excludeDirs = new Set(['node_modules', 'dist', '.git', '.pm2', 'release']),
    extensions = null,
  } = options
  const files: string[] = []
  const folders: string[] = []
  if (!fs.existsSync(startDir)) return { files, folders }
  const stack = [startDir]
  while (stack.length) {
    const current = stack.pop()
    if (!current) continue
    folders.push(current)
    const entries = fs.readdirSync(current, { withFileTypes: true })
    entries.forEach((entry: Dirent) => {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name, excludeDirs)) stack.push(abs)
        return
      }
      if (extensions instanceof Set) {
        const ext = path.extname(entry.name).toLowerCase()
        if (!extensions.has(ext)) return
      }
      files.push(abs)
    })
  }
  return { files, folders }
}

function collectRootFiles(rootDir: string, options: RootFileOptions = {}): string[] {
  const {
    extensions = null,
    excludedFiles = new Set(),
  } = options
  const out: string[] = []
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
  entries.forEach((entry: Dirent) => {
    if (!entry.isFile()) return
    if (excludedFiles.has(entry.name)) return
    if (extensions instanceof Set) {
      const ext = path.extname(entry.name).toLowerCase()
      if (!extensions.has(ext) && !extensions.has(entry.name.toLowerCase())) return
    }
    out.push(path.join(rootDir, entry.name))
  })
  return out
}

function isProbablyText(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r')
    const size = Math.min(4096, fs.statSync(filePath).size)
    const buffer = Buffer.alloc(size)
    fs.readSync(fd, buffer, 0, size, 0)
    fs.closeSync(fd)
    return !buffer.includes(0)
  } catch (_) {
    return false
  }
}

module.exports = {
  toPosix,
  resolveProjectRoot,
  relFrom,
  readUtf8,
  readJson,
  readUtf8Async,
  readJsonAsync,
  lineCount,
  pathExists,
  mapLimit,
  walkFilesRecursive,
  collectFilesAndFolders,
  collectRootFiles,
  isProbablyText,
}
