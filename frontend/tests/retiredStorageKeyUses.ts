// Shared by tests/portalLegalTranslateDisclosure.test.ts and tests/publicFirstPaint.test.ts (a helper, not a test).
//
// A retired storage key is one the storefront no longer writes: first paint only REMOVES it from a visitor's
// device. That is why it has no row in the cookie table. The exemption is only true while every use of the key
// is that removal, so this lists every use that is anything else: a literal outside the one declaration, an
// identifier outside its declaration, the removal list's own array, or the single removeItem loop. Reading it,
// writing it, indexing the list (RETIRED_PORTAL_STORAGE_KEYS[1]), spreading or mapping the list, importing the
// constants elsewhere: all are reported.
import ts from 'typescript'

export const RETIRED_KEY_CONSTANTS = ['RETIRED_PORTAL_CACHE_KEY', 'RETIRED_PORTAL_MAP_CONSENT_KEY'] as const
export const RETIRED_KEY_LIST = 'RETIRED_PORTAL_STORAGE_KEYS'
export const RETIRED_KEY_VALUES = ['business-os-catalog-portal-cache', 'business-os-portal-map-consent-v1'] as const

const declaredName = (node: ts.Node): string | null => (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) ? node.name.text : null)

// `for (const key of LIST) storage?.removeItem(key)`, with or without braces, and nothing else in the body.
function isRemovalLoop(loop: ts.ForOfStatement): boolean {
  const declaration = loop.initializer
  if (!ts.isVariableDeclarationList(declaration) || declaration.declarations.length !== 1) return false
  const variable = declaration.declarations[0].name
  if (!ts.isIdentifier(variable)) return false
  let body: ts.Statement = loop.statement
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1) return false
    body = body.statements[0]
  }
  if (!ts.isExpressionStatement(body)) return false
  const call = body.expression
  if (!ts.isCallExpression(call) || call.arguments.length !== 1) return false
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'removeItem') return false
  const argument = call.arguments[0]
  return ts.isIdentifier(argument) && argument.text === variable.text
}

export function retiredKeyUseProblems(source: ts.SourceFile): string[] {
  const problems: string[] = []
  const where = (node: ts.Node) => `line ${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if ((RETIRED_KEY_VALUES as readonly string[]).includes(node.text)) {
        const owner = ts.isStringLiteral(node) && node.parent && declaredName(node.parent)
        const ok = owner && (RETIRED_KEY_CONSTANTS as readonly string[]).includes(owner) && (node.parent as ts.VariableDeclaration).initializer === node
        if (!ok) problems.push(`${where(node)}: the retired key ${node.text} is written out as a literal outside its one declaration`)
      }
    } else if (ts.isIdentifier(node)) {
      const name = node.text
      const parent = node.parent
      const isKeyConstant = (RETIRED_KEY_CONSTANTS as readonly string[]).includes(name)
      if (isKeyConstant || name === RETIRED_KEY_LIST) {
        let ok = false
        if (parent && ts.isVariableDeclaration(parent) && parent.name === node) ok = true
        else if (isKeyConstant && parent && ts.isArrayLiteralExpression(parent) && parent.parent && declaredName(parent.parent) === RETIRED_KEY_LIST) ok = true
        else if (name === RETIRED_KEY_LIST && parent && ts.isForOfStatement(parent) && parent.expression === node && isRemovalLoop(parent)) ok = true
        if (!ok) problems.push(`${where(node)}: ${name} is used for something other than being removed (${parent ? ts.SyntaxKind[parent.kind] : 'unknown'})`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return problems
}

export const parseText = (text: string, name = 'probe.ts'): ts.SourceFile => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
