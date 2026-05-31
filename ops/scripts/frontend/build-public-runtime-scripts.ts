/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const FRONTEND_ROOT = path.join(PROJECT_ROOT, 'frontend')
const FRONTEND_REQUIRE = createRequire(path.join(FRONTEND_ROOT, 'package.json'))
const ts = FRONTEND_REQUIRE('typescript')

const GENERATED_HEADER = [
  '/*',
  ' * Generated from frontend/src/public-runtime/*.ts.',
  ' * Run: npm.cmd --prefix frontend run build:public-runtime',
  ' */',
  '',
].join('\n')

const RUNTIME_SCRIPTS = [
  {
    source: path.join(FRONTEND_ROOT, 'src', 'public-runtime', 'runtime-noise-guard.ts'),
    output: path.join(FRONTEND_ROOT, 'public', 'runtime-noise-guard.js'),
  },
  {
    source: path.join(FRONTEND_ROOT, 'src', 'public-runtime', 'theme-bootstrap.ts'),
    output: path.join(FRONTEND_ROOT, 'public', 'theme-bootstrap.js'),
  },
  {
    source: path.join(FRONTEND_ROOT, 'src', 'public-runtime', 'service-worker.ts'),
    output: path.join(FRONTEND_ROOT, 'public', 'sw.js'),
  },
]

function toProjectPath(filePath) {
  return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/')
}

function formatDiagnostic(diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  if (!diagnostic.file || typeof diagnostic.start !== 'number') return message
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  return `${toProjectPath(diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} ${message}`
}

function transpileRuntimeScript(sourcePath) {
  const source = fs.readFileSync(sourcePath, 'utf8')
  const result = ts.transpileModule(source, {
    fileName: sourcePath,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      removeComments: false,
      newLine: ts.NewLineKind.LineFeed,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  })
  const diagnostics = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  if (diagnostics.length) {
    throw new Error(diagnostics.map(formatDiagnostic).join('\n'))
  }
  return `${GENERATED_HEADER}${result.outputText.replace(/\s+$/, '')}\n`
}

function writeIfChanged(filePath, content) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  if (current === content) return false
  fs.writeFileSync(filePath, content, 'utf8')
  return true
}

function main() {
  const checkOnly = process.argv.includes('--check')
  const changed = []
  const stale = []

  for (const runtimeScript of RUNTIME_SCRIPTS) {
    const output = transpileRuntimeScript(runtimeScript.source)
    const current = fs.existsSync(runtimeScript.output) ? fs.readFileSync(runtimeScript.output, 'utf8') : ''
    if (checkOnly) {
      if (current !== output) stale.push(toProjectPath(runtimeScript.output))
      continue
    }
    if (writeIfChanged(runtimeScript.output, output)) changed.push(toProjectPath(runtimeScript.output))
  }

  if (stale.length) {
    console.error('Public runtime scripts are stale. Regenerate these files:')
    for (const filePath of stale) console.error(`- ${filePath}`)
    process.exit(1)
  }

  if (checkOnly) {
    console.log('Public runtime scripts match TypeScript sources.')
    return
  }

  if (changed.length) {
    console.log(`Generated ${changed.length} public runtime script(s):`)
    for (const filePath of changed) console.log(`- ${filePath}`)
    return
  }

  console.log('Public runtime scripts are already up to date.')
}

main()
