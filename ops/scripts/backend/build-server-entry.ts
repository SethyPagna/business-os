/* eslint-disable no-console */
'use strict'

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const BACKEND_ROOT = path.join(PROJECT_ROOT, 'backend')
const FRONTEND_REQUIRE = createRequire(path.join(PROJECT_ROOT, 'frontend', 'package.json'))
type TypeScriptModule = typeof import('typescript')
type TypeScriptDiagnostic = import('typescript').Diagnostic

const ts = FRONTEND_REQUIRE('typescript') as TypeScriptModule

const SOURCE_PATH = path.join(BACKEND_ROOT, 'server.ts')
const OUTPUT_PATH = path.join(BACKEND_ROOT, 'server.js')
const GENERATED_HEADER = [
  '/*',
  ' * Generated from backend/server.ts.',
  ' * Run: npm.cmd --prefix backend run build:server-entry',
  ' */',
  '',
].join('\n')

function toProjectPath(filePath: string): string {
  return path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/')
}

function formatDiagnostic(diagnostic: TypeScriptDiagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  if (!diagnostic.file || typeof diagnostic.start !== 'number') return message
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  return `${toProjectPath(diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} ${message}`
}

function transpileServerEntry(): string {
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

function writeIfChanged(filePath: string, content: string): boolean {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  if (current === content) return false
  fs.writeFileSync(filePath, content, 'utf8')
  return true
}

function main(): void {
  const checkOnly = process.argv.includes('--check')
  const output = transpileServerEntry()
  const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : ''

  if (checkOnly) {
    if (current !== output) {
      console.error(`${toProjectPath(OUTPUT_PATH)} is stale. Run npm.cmd --prefix backend run build:server-entry.`)
      process.exit(1)
    }
    console.log('Backend server entry matches TypeScript source.')
    return
  }

  if (writeIfChanged(OUTPUT_PATH, output)) {
    console.log(`Generated ${toProjectPath(OUTPUT_PATH)} from ${toProjectPath(SOURCE_PATH)}.`)
    return
  }

  console.log('Backend server entry is already up to date.')
}

main()
