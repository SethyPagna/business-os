#!/usr/bin/env node
/* eslint-disable no-console */
// Compiles the small standalone runtime scripts under frontend/src/public-runtime
// (loaded via plain <script> tags in index.html, before React mounts) into plain
// JS files in frontend/public/. These files intentionally run outside the Vite
// module graph, so they are type-stripped with the TypeScript compiler here
// rather than being bundled.
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..', '..')
const frontendDir = path.join(root, 'frontend')
const srcDir = path.join(frontendDir, 'src', 'public-runtime')
const outDir = path.join(frontendDir, 'public')
const checkOnly = process.argv.includes('--check')

const BANNER = '/*\n' +
  ' * Generated from frontend/src/public-runtime/*.ts.\n' +
  ' * Run: npm.cmd --prefix frontend run build:public-runtime\n' +
  ' */\n'

// Line endings are not content. Exported so the regression test can drive the
// same function this check uses, rather than a copy of it.
function normalizeEol(text) {
  return String(text).replace(/\r\n/g, '\n')
}

// Source file -> output file in frontend/public. service-worker.ts emits sw.js
// so it registers at the site root as /sw.js (required for full-origin scope).
const FILES = [
  ['runtime-noise-guard.ts', 'runtime-noise-guard.js'],
  ['theme-bootstrap.ts', 'theme-bootstrap.js'],
  ['service-worker.ts', 'sw.js'],
]

function loadTypeScript() {
  const candidates = [
    path.join(frontendDir, 'node_modules', 'typescript'),
    path.join(root, 'node_modules', 'typescript'),
    'typescript',
  ]
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch (_) {
      // try next candidate
    }
  }
  throw new Error(
    'Could not resolve the "typescript" package. Run `npm install` in frontend/ first.'
  )
}

function main() {
  const ts = loadTypeScript()

  if (!fs.existsSync(srcDir)) {
    throw new Error(`Missing public-runtime source directory: ${srcDir}`)
  }
  if (!checkOnly) fs.mkdirSync(outDir, { recursive: true })

  for (const [sourceName, outputName] of FILES) {
    const sourcePath = path.join(srcDir, sourceName)
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing public-runtime source file: ${sourcePath}`)
    }
    const source = fs.readFileSync(sourcePath, 'utf8')
    const { outputText, diagnostics } = ts.transpileModule(source, {
      fileName: sourceName,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
        removeComments: false,
      },
      reportDiagnostics: true,
    })

    if (diagnostics && diagnostics.length) {
      const formatted = diagnostics
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
        .join('\n')
      throw new Error(`TypeScript reported problems in ${sourceName}:\n${formatted}`)
    }

    const outputPath = path.join(outDir, outputName)
    const expected = BANNER + outputText
    if (checkOnly) {
      const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : ''
      // Compare CONTENT, not bytes. Git stores these files with LF; this
      // checkout is core.autocrlf=true, so they arrive on disk with CRLF while
      // this generator always emits LF. A raw byte comparison therefore called
      // a pristine checkout stale forever -- and since this is step 2 of the
      // `test:utils` chain, and that chain stops at the first red, it could
      // stop a lane before a single one of its 170 test files ever ran. A
      // staleness check answers "is the generated code out of date", and a
      // line ending is not the generated code.
      if (normalizeEol(current) !== normalizeEol(expected)) {
        throw new Error(`Generated runtime is stale: ${path.relative(root, outputPath)}. Run npm.cmd --prefix frontend run build:public-runtime.`)
      }
      console.log(`Verified ${path.relative(root, outputPath)}`)
      continue
    }
    fs.writeFileSync(outputPath, expected, 'utf8')
    console.log(`Built ${path.relative(root, sourcePath)} -> ${path.relative(root, outputPath)}`)
  }
}

// Exported so the regression test drives the real comparison rather than a
// copy of it; the main() guard keeps requiring this file side-effect free.
module.exports = { normalizeEol }

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`build:public-runtime failed: ${error && error.message ? error.message : error}`)
    process.exit(1)
  }
}
