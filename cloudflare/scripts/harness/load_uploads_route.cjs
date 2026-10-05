// Takes the real `app.get('/uploads/*', ...)` handler out of src/index.ts
// (TypeScript AST), resolving every identifier it uses through index.ts's own
// imports, so a test exercises what index.ts actually wires rather than a copy
// of it. Anything it cannot resolve is an error, never a guess.
//
// Same technique as test-quarantine-unreachable-pure.cjs, shared so the image
// variant wiring test does not need a second copy of the logic in its body.
//
//   const { handlers, loadTs } = loadUploadsRoute({ stubs: { quotaGuard: {...} } })
//   const app = new Hono(); app.get('/uploads/*', ...handlers)
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SRC = path.join(__dirname, '..', '..', 'src')

function loadUploadsRoute({ indexTs = process.env.WORKER_INDEX_TS || path.join(SRC, 'index.ts'), stubs = {} } = {}) {
  const loaded = new Map()
  function loadTs(file) {
    if (loaded.has(file)) return loaded.get(file).exports
    const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
    })
    const module = { exports: {} }
    loaded.set(file, module)
    const localRequire = (request) => {
      if (!request.startsWith('.')) return require(request)
      const base = path.resolve(path.dirname(file), request)
      const resolved = [`${base}.ts`, path.join(base, 'index.ts')].find((candidate) => fs.existsSync(candidate))
      if (!resolved) throw new Error(`cannot resolve ${request} from ${path.basename(file)}`)
      const stub = stubs[path.basename(resolved, '.ts')]
      if (stub) return stub
      if (resolved === path.resolve(indexTs)) return {}
      return loadTs(resolved)
    }
    new Function('exports', 'require', 'module', outputText)(module.exports, localRequire, module)
    return module.exports
  }

  const source = fs.readFileSync(indexTs, 'utf8')
  const file = ts.createSourceFile(indexTs, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
  const imports = new Map()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue
    const from = statement.moduleSpecifier.text
    const clause = statement.importClause
    if (clause.name) imports.set(clause.name.text, { from, name: 'default' })
    const bindings = clause.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) if (!element.isTypeOnly) imports.set(element.name.text, { from, name: (element.propertyName || element.name).text })
    }
    if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, { from, name: '*' })
  }
  const routes = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'get'
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'app'
      && node.arguments.length >= 2 && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === '/uploads/*') {
      routes.push(node.arguments.slice(1).map((argument) => argument.getText(file)))
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (routes.length !== 1) throw new Error(`index.ts has ${routes.length} app.get('/uploads/*') routes, expected 1`)
  const handlers = routes[0].map((text) => {
    const js = ts.transpileModule(`module.exports = (${text})`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const jsFile = ts.createSourceFile('handler.js', js, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS)
    const declared = new Set(['module', 'exports'])
    const used = new Set()
    const walk = (node) => {
      if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) declared.add(node.name.text)
      if (ts.isIdentifier(node)) {
        const parent = node.parent
        const isMemberName = parent && ((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node))
        if (!isMemberName) used.add(node.text)
      }
      ts.forEachChild(node, walk)
    }
    walk(jsFile)
    const names = []
    const values = []
    for (const name of used) {
      if (declared.has(name) || name in globalThis) continue
      const origin = imports.get(name)
      if (!origin) throw new Error(`the /uploads/* handler uses ${name}, which is not imported in index.ts`)
      let target
      if (origin.from.startsWith('.')) {
        const base = path.resolve(path.dirname(indexTs), origin.from)
        const resolved = [`${base}.ts`, path.join(base, 'index.ts')].find((candidate) => fs.existsSync(candidate))
        if (!resolved) throw new Error(`cannot resolve ${origin.from}`)
        target = stubs[path.basename(resolved, '.ts')] || loadTs(resolved)
      } else target = require(origin.from)
      const value = origin.name === '*' || (origin.name === 'default' && !('default' in target)) ? target : target[origin.name]
      if (value === undefined) throw new Error(`${origin.from} has no export ${origin.name}`)
      names.push(name)
      values.push(value)
    }
    const module = { exports: null }
    new Function('module', ...names, js)(module, ...values)
    if (typeof module.exports !== 'function') throw new Error('the /uploads/* handler is not a function')
    return module.exports
  })
  return { handlers, loadTs }
}

module.exports = { loadUploadsRoute }
