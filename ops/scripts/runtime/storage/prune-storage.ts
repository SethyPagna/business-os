#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..', '..', '..', '..')
const requireFromBackend = createRequire(path.join(root, 'backend', 'package.json'))
const DEFAULT_POLICY_PATH = path.join(root, 'ops', 'automation', 'business-os-automation.json')

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (_) {
    return {}
  }
}

function numberFromPolicy(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    policyPath: DEFAULT_POLICY_PATH,
    reportsKeep: 20,
    recoveryReportsKeep: 5,
    localBackupsKeep: 3,
    remoteBackupsKeep: 1,
    remote: true,
    deleteDemo: false,
    dockerSafePrune: false,
    logFileMaxBytes: 1024 * 1024,
    outputPath: '',
  }
  const explicit = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--dry-run') {
      args.dryRun = true
    } else if (value === '--policy') {
      explicit.add('policyPath')
      args.policyPath = path.resolve(root, argv[++index] || args.policyPath)
    } else if (value === '--reports-keep') {
      explicit.add('reportsKeep')
      args.reportsKeep = Number(argv[++index] || args.reportsKeep)
    } else if (value === '--recovery-reports-keep') {
      explicit.add('recoveryReportsKeep')
      args.recoveryReportsKeep = Number(argv[++index] || args.recoveryReportsKeep)
    } else if (value === '--local-backups-keep') {
      explicit.add('localBackupsKeep')
      args.localBackupsKeep = Number(argv[++index] || args.localBackupsKeep)
    } else if (value === '--remote-backups-keep') {
      explicit.add('remoteBackupsKeep')
      args.remoteBackupsKeep = Number(argv[++index] || args.remoteBackupsKeep)
    } else if (value === '--skip-remote') {
      explicit.add('remote')
      args.remote = false
    } else if (value === '--delete-demo') {
      explicit.add('deleteDemo')
      args.deleteDemo = true
    } else if (value === '--docker-safe-prune') {
      explicit.add('dockerSafePrune')
      args.dockerSafePrune = true
    } else if (value === '--log-file-max-bytes') {
      explicit.add('logFileMaxBytes')
      args.logFileMaxBytes = Number(argv[++index] || args.logFileMaxBytes)
    } else if (value === '--output') {
      explicit.add('outputPath')
      args.outputPath = argv[++index] || ''
    }
  }
  const policy = readJsonFile(args.policyPath)
  if (!explicit.has('reportsKeep')) args.reportsKeep = numberFromPolicy(policy?.cleanup?.runtimeReportsKeepLatest, args.reportsKeep)
  if (!explicit.has('recoveryReportsKeep')) args.recoveryReportsKeep = numberFromPolicy(policy?.cleanup?.recoveryReportsKeepLatest, args.recoveryReportsKeep)
  if (!explicit.has('localBackupsKeep')) args.localBackupsKeep = numberFromPolicy(policy?.backups?.localKeepLatest, args.localBackupsKeep)
  if (!explicit.has('remoteBackupsKeep')) args.remoteBackupsKeep = numberFromPolicy(policy?.backups?.cloudflareR2KeepLatest, args.remoteBackupsKeep)
  if (!explicit.has('deleteDemo')) args.deleteDemo = policy?.cleanup?.deleteIgnoredDemoArtifacts === true
  if (!explicit.has('dockerSafePrune')) args.dockerSafePrune = policy?.cleanup?.dockerSafePrune === true
  if (!explicit.has('logFileMaxBytes')) args.logFileMaxBytes = numberFromPolicy(policy?.cleanup?.runtimeLogFileMaxBytes, args.logFileMaxBytes)
  args.reportsKeep = Math.max(1, Math.min(200, Number(args.reportsKeep || 20) || 20))
  args.recoveryReportsKeep = Math.max(1, Math.min(100, Number(args.recoveryReportsKeep || 5) || 5))
  args.localBackupsKeep = Math.max(1, Math.min(50, Number(args.localBackupsKeep || 3) || 3))
  args.remoteBackupsKeep = Math.max(1, Math.min(50, Number(args.remoteBackupsKeep || 1) || 1))
  args.logFileMaxBytes = Math.max(64 * 1024, Math.min(50 * 1024 * 1024, Number(args.logFileMaxBytes || 1024 * 1024) || 1024 * 1024))
  args.policy = {
    path: args.policyPath,
    loaded: Object.keys(policy).length > 0,
    explicit: Array.from(explicit).sort(),
  }
  if (args.outputPath) args.outputPath = assertInsideWorkspace(path.resolve(root, args.outputPath))
  if (args.outputPath && /preview/i.test(path.basename(args.outputPath)) && !args.dryRun) {
    throw new Error('Refusing to write a preview-named prune report without --dry-run.')
  }
  return args
}

function runDockerCommand(args) {
  return execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function pruneDockerSafe({ dryRun }) {
  const planned = [
    { label: 'stopped containers', command: 'docker', args: ['container', 'prune', '-f'] },
    { label: 'builder cache', command: 'docker', args: ['builder', 'prune', '-f'] },
  ]
  const result = {
    enabled: true,
    dryRun,
    policy: 'Prunes stopped containers and Docker builder cache only. Volumes and images are never pruned by this command.',
    planned,
    systemDfBefore: null,
    results: [],
    error: null,
  }
  try {
    result.systemDfBefore = runDockerCommand(['system', 'df'])
  } catch (error) {
    result.error = error?.message || String(error)
    return result
  }
  if (dryRun) return result

  for (const entry of planned) {
    try {
      result.results.push({
        label: entry.label,
        command: `${entry.command} ${entry.args.join(' ')}`,
        ok: true,
        output: runDockerCommand(entry.args),
      })
    } catch (error) {
      result.results.push({
        label: entry.label,
        command: `${entry.command} ${entry.args.join(' ')}`,
        ok: false,
        error: error?.message || String(error),
      })
    }
  }
  try {
    result.systemDfAfter = runDockerCommand(['system', 'df'])
  } catch (error) {
    result.systemDfAfterError = error?.message || String(error)
  }
  return result
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const name = match[1]
    if (process.env[name]) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[name] = value
  }
}

function loadRuntimeEnv() {
  loadEnvFile(path.join(root, 'ops', 'runtime', 'docker-release', 'docker-release.env'))
  loadEnvFile(path.join(root, 'backend', '.env'))
  const tokenFile = path.join(root, 'ops', 'runtime', 'secrets', 'cloudflare-api-token.txt')
  if (!process.env.CLOUDFLARE_API_TOKEN_FILE && fs.existsSync(tokenFile)) {
    process.env.CLOUDFLARE_API_TOKEN_FILE = tokenFile
  }
}

function assertInsideWorkspace(targetPath) {
  const resolved = path.resolve(targetPath)
  const relative = path.relative(root, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove outside workspace: ${resolved}`)
  }
  return resolved
}

function directoryBytes(directoryPath) {
  let total = 0
  const stack = [directoryPath]
  while (stack.length) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch (_) {
      continue
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(entryPath)
        continue
      }
      if (!entry.isFile()) continue
      try {
        total += Number(fs.statSync(entryPath).size || 0) || 0
      } catch (_) {}
    }
  }
  return total
}

function pathBytes(targetPath) {
  try {
    const stats = fs.statSync(targetPath)
    if (stats.isFile()) return Number(stats.size || 0) || 0
    if (stats.isDirectory()) return directoryBytes(targetPath)
  } catch (_) {}
  return 0
}

async function pruneDirectoryChildren({ targetDir, keepLatest, namePattern = /.*/, dryRun }) {
  return pruneDirectoryEntries({ targetDir, keepLatest, namePattern, dryRun, includeFiles: false })
}

async function pruneDirectoryEntries({ targetDir, keepLatest, namePattern = /.*/, dryRun, includeFiles = false }) {
  const resolved = assertInsideWorkspace(targetDir)
  if (!fs.existsSync(resolved)) {
    return { targetDir: resolved, kept: [], removed: [], bytesRemoved: 0, dryRun }
  }
  const entries = fs.readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => (entry.isDirectory() || (includeFiles && entry.isFile())) && namePattern.test(entry.name))
    .map((entry) => {
      const absolutePath = path.join(resolved, entry.name)
      let stats = null
      try { stats = fs.statSync(absolutePath) } catch (_) {}
      return { name: entry.name, absolutePath, kind: entry.isFile() ? 'file' : 'directory', mtimeMs: Number(stats?.mtimeMs || 0) || 0 }
    })
    .sort((a, b) => {
      const timeDelta = b.mtimeMs - a.mtimeMs
      if (timeDelta !== 0) return timeDelta
      return b.name.localeCompare(a.name)
    })
  const keep = entries.slice(0, keepLatest)
  const remove = entries.slice(keepLatest)
  const removed = []
  let bytesRemoved = 0
  for (const entry of remove) {
    const bytes = pathBytes(entry.absolutePath)
    if (!dryRun) fs.rmSync(entry.absolutePath, { recursive: true, force: true })
    bytesRemoved += bytes
    removed.push({ name: entry.name, path: entry.absolutePath, kind: entry.kind, bytes })
  }
  return {
    targetDir: resolved,
    kept: keep.map((entry) => entry.name),
    removed,
    bytesRemoved,
    dryRun,
  }
}

function collectLogFiles(targetDirs) {
  const files = []
  for (const targetDir of targetDirs) {
    const resolved = assertInsideWorkspace(targetDir)
    if (!fs.existsSync(resolved)) continue
    const stack = [resolved]
    while (stack.length) {
      const current = stack.pop()
      let entries = []
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch (_) {
        continue
      }
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name)
        if (entry.isDirectory()) {
          stack.push(entryPath)
          continue
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.log')) continue
        files.push(assertInsideWorkspace(entryPath))
      }
    }
  }
  return Array.from(new Set(files)).sort()
}

function compactLogFile({ filePath, maxBytes, dryRun }) {
  const beforeBytes = pathBytes(filePath)
  if (beforeBytes <= maxBytes) {
    return { path: filePath, beforeBytes, afterBytes: beforeBytes, bytesRemoved: 0, changed: false, dryRun }
  }
  const keepBytes = Math.max(0, maxBytes - 256)
  const file = fs.openSync(filePath, 'r')
  try {
    const tail = Buffer.alloc(keepBytes)
    fs.readSync(file, tail, 0, keepBytes, beforeBytes - keepBytes)
    if (!dryRun) {
      const header = Buffer.from(`[business-os log compacted ${new Date().toISOString()}; kept newest ${keepBytes} of ${beforeBytes} bytes]\n`, 'utf8')
      fs.writeFileSync(filePath, Buffer.concat([header, tail]))
    }
  } finally {
    fs.closeSync(file)
  }
  const afterBytes = dryRun ? Math.min(beforeBytes, maxBytes) : pathBytes(filePath)
  return {
    path: filePath,
    beforeBytes,
    afterBytes,
    bytesRemoved: Math.max(0, beforeBytes - afterBytes),
    changed: true,
    dryRun,
  }
}

function compactRuntimeLogs({ maxBytes, dryRun }) {
  const targetDirs = [
    path.join(root, 'ops', 'runtime', 'logs'),
    path.join(root, 'ops', 'runtime', 'pm2'),
  ]
  const files = collectLogFiles(targetDirs)
  const results = []
  for (const filePath of files) {
    try {
      results.push(compactLogFile({ filePath, maxBytes, dryRun }))
    } catch (error) {
      results.push({
        path: filePath,
        beforeBytes: pathBytes(filePath),
        afterBytes: pathBytes(filePath),
        bytesRemoved: 0,
        changed: false,
        dryRun,
        error: error?.message || String(error),
      })
    }
  }
  return {
    targetDirs,
    maxBytes,
    files: results.length,
    compacted: results.filter((result) => result.changed).length,
    bytesRemoved: results.reduce((total, result) => total + result.bytesRemoved, 0),
    dryRun,
    results,
  }
}

function findBackupRoots() {
  const roots = [
    path.join(root, 'business-os-data', 'backups'),
    path.join(root, 'ops', 'runtime', 'docker-release', 'backups'),
  ]
  const organizationsRoot = path.join(root, 'business-os-data', 'organizations')
  if (fs.existsSync(organizationsRoot)) {
    for (const entry of fs.readdirSync(organizationsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(path.join(organizationsRoot, entry.name, 'backups'))
    }
  }
  return Array.from(new Set(roots.map((item) => path.resolve(item))))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  loadRuntimeEnv()
  const {
    pruneLocalBackupVersions,
    pruneRemoteBackupVersions,
  } = requireFromBackend('./src/services/backupPackages.ts')

  const reports = await pruneDirectoryEntries({
    targetDir: path.join(root, 'ops', 'runtime', 'reports'),
    keepLatest: args.reportsKeep,
    dryRun: args.dryRun,
    includeFiles: true,
  })

  const recoveryReports = await pruneDirectoryEntries({
    targetDir: path.join(root, 'ops', 'runtime', 'recovery-reports'),
    keepLatest: args.recoveryReportsKeep,
    dryRun: args.dryRun,
    includeFiles: true,
  })

  const runtimeLogs = compactRuntimeLogs({
    maxBytes: args.logFileMaxBytes,
    dryRun: args.dryRun,
  })

  const localBackups = []
  for (const backupRoot of findBackupRoots()) {
    localBackups.push(await pruneLocalBackupVersions({
      rootDir: backupRoot,
      keepLatest: args.localBackupsKeep,
      dryRun: args.dryRun,
      remote: false,
    }))
  }

  let demo = null
  if (args.deleteDemo) {
    const demoPath = path.join(root, 'ops', 'demo')
    demo = {
      targetDir: demoPath,
      bytesRemoved: fs.existsSync(demoPath) ? directoryBytes(demoPath) : 0,
      removed: fs.existsSync(demoPath),
      dryRun: args.dryRun,
    }
    assertInsideWorkspace(demoPath)
    if (demo.removed && !args.dryRun) fs.rmSync(demoPath, { recursive: true, force: true })
  }

  let remoteBackups = null
  if (args.remote) {
    try {
      remoteBackups = await pruneRemoteBackupVersions({
        remoteKeepLatest: args.remoteBackupsKeep,
        dryRun: args.dryRun,
      })
    } catch (error) {
      remoteBackups = {
        source: 'r2',
        error: error?.message || String(error),
        dryRun: args.dryRun,
      }
    }
  }

  const dockerSafePrune = args.dockerSafePrune
    ? pruneDockerSafe({ dryRun: args.dryRun })
    : null

  const summary = {
    policy: args.policy,
    outputPath: args.outputPath || null,
    generatedAt: new Date().toISOString(),
    reports,
    recoveryReports,
    runtimeLogs,
    localBackups,
    remoteBackups,
    demo,
    dockerSafePrune,
  }
  if (args.outputPath) {
    fs.mkdirSync(path.dirname(args.outputPath), { recursive: true })
    fs.writeFileSync(args.outputPath, `${JSON.stringify(summary, null, 2)}\n`)
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(`[prune-storage] ${error?.message || error}`)
  process.exit(1)
})
