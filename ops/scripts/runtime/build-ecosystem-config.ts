/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const OPS_ROOT = path.join(PROJECT_ROOT, 'ops')
const FRONTEND_REQUIRE = createRequire(path.join(PROJECT_ROOT, 'frontend', 'package.json'))
const ts = FRONTEND_REQUIRE('typescript')

const SOURCE_PATH = path.join(OPS_ROOT, 'config', 'ecosystem.config.ts')
const OUTPUT_PATH = path.join(OPS_ROOT, 'config', 'ecosystem.config.js')
const GENERATED_HEADER = [
  '/*',
  ' * Generated from ops/config/ecosystem.config.ts.',
  ' * Run: npm.cmd --prefix ops run build:ecosystem-config',
  ' */',
  '',
].join('\n')

function toProjectPath(filePath) {
  return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/')
}

function formatDiagnostic(diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  if (!diagnostic.file || typeof diagnostic.start !== 'number') return message
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  return `${toProjectPath(diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} ${message}`
}

function transpileEcosystemConfig() {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8')
  const result = ts.transpileModule(source, {
    fileName: SOURCE_PATH,
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
  const output = transpileEcosystemConfig()
  const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : ''

  if (checkOnly) {
    if (current !== output) {
      console.error(`${toProjectPath(OUTPUT_PATH)} is stale. Run npm.cmd --prefix ops run build:ecosystem-config.`)
      process.exit(1)
    }
    console.log('PM2 ecosystem config matches TypeScript source.')
    return
  }

  if (writeIfChanged(OUTPUT_PATH, output)) {
    console.log(`Generated ${toProjectPath(OUTPUT_PATH)} from ${toProjectPath(SOURCE_PATH)}.`)
    return
  }

  console.log('PM2 ecosystem config is already up to date.')
}

main()
