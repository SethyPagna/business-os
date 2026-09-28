import { readFileSync } from 'node:fs'
import ts from 'typescript'

export type Scope = Record<string, unknown>

export interface ComponentSource {
  url: URL
  text: string
  file: ts.SourceFile
}

export interface HandlerOptions {
  locals: readonly string[]
  include?: readonly string[]
}

type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
type ImportBinding = { specifier: string; importedName: string | null }

export function readComponent(relativeToSrc: string): ComponentSource {
  const url = new URL(`../src/${relativeToSrc}`, import.meta.url)
  const text = readFileSync(url, 'utf8').replace(/\r\n/g, '\n')
  return { url, text, file: ts.createSourceFile(url.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }
}

function isFunctionNode(node: ts.Node | undefined): node is FunctionNode {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node))
}

function unwrapUseCallback(initializer: ts.Expression): ts.Expression {
  if (ts.isCallExpression(initializer) && initializer.expression.getText() === 'useCallback') return initializer.arguments[0]
  return initializer
}

export function findFunction(component: ComponentSource, name: string): FunctionNode {
  const matches: FunctionNode[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      const fn = unwrapUseCallback(node.initializer)
      if (isFunctionNode(fn)) matches.push(fn)
    }
    ts.forEachChild(node, visit)
  }
  visit(component.file)
  if (matches.length !== 1) throw new Error(`expected exactly one function named ${name}, found ${matches.length}`)
  return matches[0]
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node) return true
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.name === node) return true
  if ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent)) && parent.name === node) return true
  return ts.isJsxAttribute(parent) || ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)
}

export function freeIdentifiers(root: ts.Node): string[] {
  const declared = new Set<string>()
  const referenced = new Set<string>()
  const declare = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) declared.add(name.text)
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) declare(element.name)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) declare(node.name)
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node)) && node.name) declared.add(node.name.text)
    if (ts.isIdentifier(node) && !isDeclarationName(node)) referenced.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return [...referenced].filter((name) => !declared.has(name))
}

function topLevelDeclarations(component: ComponentSource): Map<string, ts.Statement> {
  const declarations = new Map<string, ts.Statement>()
  for (const statement of component.file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, statement)
      }
    }
  }
  return declarations
}

function importBindings(component: ComponentSource): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>()
  for (const statement of component.file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
    const clause = statement.importClause
    if (clause.name) bindings.set(clause.name.text, { specifier, importedName: 'default' })
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      bindings.set(clause.namedBindings.name.text, { specifier, importedName: null })
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly) continue
        bindings.set(element.name.text, { specifier, importedName: (element.propertyName ?? element.name).text })
      }
    }
  }
  return bindings
}

async function loadImport(component: ComponentSource, binding: ImportBinding, name: string): Promise<unknown> {
  const relative = binding.specifier.startsWith('.')
  if (relative && !binding.specifier.endsWith('.ts')) {
    throw new Error(`${name} comes from ${binding.specifier}, which Node cannot load: supply it as a local`)
  }
  const module = await import(relative ? new URL(binding.specifier, component.url).href : binding.specifier) as Record<string, unknown>
  return binding.importedName === null ? module : module[binding.importedName]
}

function functionSource(component: ComponentSource, name: string, fn: FunctionNode): string {
  const text = fn.getText(component.file)
  return ts.isFunctionDeclaration(fn) ? text : `const ${name} = ${text}`
}

function withoutExportKeyword(text: string): string {
  return text.replace(/^export\s+(?:default\s+)?/, '')
}

export async function compileHandler<F>(component: ComponentSource, name: string, options: HandlerOptions): Promise<(scope: Scope) => F> {
  const locals = new Set(options.locals)
  const topLevel = topLevelDeclarations(component)
  const imports = importBindings(component)
  const included = [name, ...(options.include ?? [])].map((entry) => ({ name: entry, fn: findFunction(component, entry) }))
  const pending = included.flatMap((entry) => freeIdentifiers(entry.fn))
  const seen = new Set<string>()
  const statements = new Set<ts.Statement>()
  const importValues = new Map<string, unknown>()
  const includedNames = new Set(included.map((entry) => entry.name))
  while (pending.length) {
    const identifier = pending.pop()!
    if (seen.has(identifier) || locals.has(identifier) || includedNames.has(identifier)) continue
    seen.add(identifier)
    const statement = topLevel.get(identifier)
    if (statement) {
      statements.add(statement)
      pending.push(...freeIdentifiers(statement))
      continue
    }
    const binding = imports.get(identifier)
    if (binding) {
      importValues.set(identifier, await loadImport(component, binding, identifier))
      continue
    }
    if (identifier in globalThis) continue
    throw new Error(`${name} reads ${identifier}: supply it as a local`)
  }
  const ordered = [...statements].sort((a, b) => a.pos - b.pos).map((statement) => withoutExportKeyword(statement.getText(component.file)))
  const source = [...ordered, ...included.map((entry) => functionSource(component, entry.name, entry.fn))].join('\n')
  const js = ts.transpileModule(source, {
    fileName: 'handler.tsx',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText
  const parameterNames = [...importValues.keys(), ...locals]
  const factory = new Function(...parameterNames, `${js}\nreturn ${name}`) as (...values: unknown[]) => F
  return (scope: Scope) => {
    const missing = [...locals].filter((local) => !(local in scope))
    if (missing.length) throw new Error(`${name}: scope is missing ${missing.join(', ')}`)
    return factory(...importValues.values(), ...[...locals].map((local) => scope[local]))
  }
}
