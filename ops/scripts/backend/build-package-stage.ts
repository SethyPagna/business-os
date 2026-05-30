'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../../..')
const backendRoot = path.join(root, 'backend')
const stageRoot = path.join(backendRoot, '.pkg-stage')

const COPY_ENTRIES = [
  'server.js',
  'src',
  'frontend-dist',
]

function toPosix(file) {
  return file.split(path.sep).join('/')
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return
  const resolved = path.resolve(dir)
  if (!resolved.startsWith(backendRoot + path.sep) || path.basename(resolved) !== '.pkg-stage') {
    throw new Error(`Refusing to remove unexpected package stage: ${resolved}`)
  }
  fs.rmSync(resolved, { recursive: true, force: true })
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function copyEntry(name) {
  const source = path.join(backendRoot, name)
  const target = path.join(stageRoot, name)
  if (!fs.existsSync(source)) return
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter(file) {
      return !file.includes(`${path.sep}node_modules${path.sep}`) &&
        !file.includes(`${path.sep}.pkg-stage${path.sep}`)
    },
  })
}

function walkFiles(dir, visitor) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(fullPath, visitor)
    } else if (entry.isFile()) {
      visitor(fullPath)
    }
  }
}

function rewriteRuntimeRequires(source) {
  return source
    .replace(/require\((['"])([^'"]+)\.ts\1\)/g, "require($1$2.js$1)")
    .replace(/(['"`])([^'"`\r\n]+)\.ts\1/g, '$1$2.js$1')
}

function rewriteStageSourceFiles() {
  const pendingRenames = []
  walkFiles(stageRoot, (file) => {
    const ext = path.extname(file)
    if (ext !== '.js' && ext !== '.ts') return
    const original = fs.readFileSync(file, 'utf8')
    const rewritten = rewriteRuntimeRequires(original)
    if (rewritten !== original) fs.writeFileSync(file, rewritten)
    if (ext === '.ts') pendingRenames.push(file)
  })

  for (const source of pendingRenames) {
    const target = source.slice(0, -3) + '.js'
    fs.renameSync(source, target)
  }
}

function buildStagePackageJson() {
  const packagePath = path.join(backendRoot, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  packageJson.private = true
  packageJson.scripts = {
    start: 'node server.js',
  }
  packageJson.pkg = {
    ...(packageJson.pkg || {}),
    scripts: [
      'server.js',
      'src/**/*.js',
    ],
    assets: [
      'node_modules/libpq/**/*.node',
      'node_modules/pg-native/**/*.node',
      'node_modules/sharp/**/*',
      'node_modules/@img/**/*',
      'node_modules/@img/**/*.node',
      'node_modules/@img/**/*.dll',
      'src/db/postgresSchema.sql',
      'frontend-dist/**/*',
    ],
  }
  fs.writeFileSync(path.join(stageRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
}

function assertStage() {
  const badFiles = []
  walkFiles(stageRoot, (file) => {
    if (file.endsWith('.ts')) badFiles.push(toPosix(path.relative(stageRoot, file)))
  })
  if (badFiles.length) {
    throw new Error(`Package stage still contains TypeScript files:\n${badFiles.join('\n')}`)
  }

  const staleRequires = []
  walkFiles(stageRoot, (file) => {
    if (!file.endsWith('.js')) return
    const source = fs.readFileSync(file, 'utf8')
    if (/require\((['"])[^'"]+\.ts\1\)/.test(source)) {
      staleRequires.push(toPosix(path.relative(stageRoot, file)))
    }
  })
  if (staleRequires.length) {
    throw new Error(`Package stage still contains .ts runtime requires:\n${staleRequires.join('\n')}`)
  }
}

function main() {
  removeDir(stageRoot)
  ensureDir(stageRoot)
  for (const entry of COPY_ENTRIES) copyEntry(entry)
  rewriteStageSourceFiles()
  buildStagePackageJson()
  assertStage()
  console.log(`Prepared backend package stage at ${toPosix(path.relative(root, stageRoot))}`)
}

main()
