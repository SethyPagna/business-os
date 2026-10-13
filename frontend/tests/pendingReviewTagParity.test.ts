// The Worker decides WHAT can wait in the review queue; the browser decides which rows wear the "waiting
// for review" tag. The two meet only in three string literals per kind of request -- section, entity type,
// and whether the request points at a record (an id) or at no record yet (a create, the saved-reasons list).
// Nothing but this test keeps them in step: rename `entityType: 'fee'` in the Worker, or add a queueable
// section there, and the tags silently stop (or never start) drawing.
//
// Worker side, read from cloudflare/src with the TypeScript parser:
//   - every maybeQueueForReview(env, user, '<section>', { entityType, entityId, ... }) call;
//   - every raw `INSERT INTO pending_actions(...) VALUES('<section>','<action>','<entity>',<id>, ...)`
//     (lib/productDelete.ts writes the product-removal requests that way);
//   - every registerApplier('<section>', '<action>', '<entity>') (what a reviewer can approve).
// Browser side, read from frontend/src: every <PendingReviewTag section entityType ids> and every
// <PendingReviewCountBadge section entityType> element.
//
// Each (section, entity type, kind) the Worker can queue needs a tag that draws it, and each tag needs a
// Worker request to draw. kind is "record" (entityId is an id) or "creates" (entityId is null: the request
// has no record yet, and the browser counts it under the '*' slot).
//
// Run: node tests/pendingReviewTagParity.test.ts
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'

const ts = createRequire(new URL('../../cloudflare/package.json', import.meta.url))('typescript')
const repo = path.resolve(import.meta.dirname, '..', '..')

function walk(dir: string, extensions: string[], into: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, extensions, into); continue }
    if (extensions.some((extension) => name.endsWith(extension))) into[path.relative(repo, full).replace(/\\/g, '/')] = readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
  }
  return into
}
const workerFiles = walk(path.join(repo, 'cloudflare', 'src'), ['.ts'])
const browserFiles = walk(path.join(repo, 'frontend', 'src'), ['.tsx'])

type Kind = 'record' | 'creates'
const key = (section: string, entityType: string, kind: Kind) => `${section}:${entityType}:${kind}`

const literal = (node: any): string | null => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null)
function parse(file: string, source: string, kind: number) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
}
function visit(node: any, callback: (node: any) => void): void {
  callback(node)
  ts.forEachChild(node, (child: any) => visit(child, callback))
}

/** What the Worker can put in the review queue, and what it can apply. */
function readWorker(files: Record<string, string>): { queued: Map<string, string>; appliers: Set<string> } {
  const queued = new Map<string, string>() // key -> where
  const appliers = new Set<string>() // section:entityType
  for (const [file, source] of Object.entries(files)) {
    if (source.includes('maybeQueueForReview(') || source.includes('registerApplier(')) {
      visit(parse(file, source, ts.ScriptKind.TS), (node) => {
        if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return
        if (node.expression.text === 'maybeQueueForReview') {
          const section = literal(node.arguments[2])
          const input = node.arguments[3]
          if (!section || !input || !ts.isObjectLiteralExpression(input)) return
          const property = (name: string) => input.properties.find((entry: any) => ts.isPropertyAssignment(entry) && entry.name.getText() === name)
          const entityType = literal(property('entityType')?.initializer)
          assert.ok(entityType, `${file}: maybeQueueForReview for '${section}' must name a literal entityType so the browser can match it`)
          const id = property('entityId')?.initializer
          const kind: Kind = !id || id.kind === ts.SyntaxKind.NullKeyword ? 'creates' : 'record'
          queued.set(key(section, entityType, kind), `${file} maybeQueueForReview`)
        }
        if (node.expression.text === 'registerApplier') {
          const section = literal(node.arguments[0])
          const entityType = literal(node.arguments[2])
          if (section && entityType) appliers.add(`${section}:${entityType}`)
        }
      })
    }
    for (const match of source.matchAll(/INSERT INTO pending_actions\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/g)) {
      const columns = match[1].split(',').map((column) => column.trim())
      const values = match[2].split(',').map((value) => value.trim())
      const at = (column: string) => values[columns.indexOf(column)] ?? ''
      const quoted = (value: string) => /^'([^']*)'$/.exec(value)?.[1] ?? null
      // createPendingAction is the one generic creator: it binds section and entity type from its caller,
      // and every caller is a maybeQueueForReview call read above. A bound insert anywhere else would be a
      // second way into the queue that this test cannot see.
      if (at('section').startsWith('@')) {
        assert.equal(file, 'cloudflare/src/lib/pendingActions.ts', `${file}: only createPendingAction may insert into pending_actions with a bound section`)
        continue
      }
      const section = quoted(at('section'))
      const entityType = quoted(at('entity_type'))
      assert.ok(section && entityType, `${file}: a raw INSERT INTO pending_actions must write literal section and entity_type so the browser can match it`)
      const entityId = at('entity_id')
      queued.set(key(section, entityType, entityId === 'NULL' || entityId === 'null' ? 'creates' : 'record'), `${file} INSERT INTO pending_actions`)
    }
  }
  return { queued, appliers }
}

/** Which kinds of request the browser draws a tag for. */
function readBrowser(files: Record<string, string>): Map<string, string> {
  const drawn = new Map<string, string>()
  for (const [file, source] of Object.entries(files)) {
    if (!source.includes('<PendingReviewTag') && !source.includes('<PendingReviewCountBadge')) continue
    visit(parse(file, source, ts.ScriptKind.TSX), (node) => {
      if (!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) return
      const name = node.tagName.getText()
      if (name !== 'PendingReviewTag' && name !== 'PendingReviewCountBadge') return
      const attribute = (attributeName: string) => node.attributes.properties.find((entry: any) => ts.isJsxAttribute(entry) && entry.name.getText() === attributeName)
      const text = (attributeName: string): string | null => {
        const initializer = attribute(attributeName)?.initializer
        if (!initializer) return null
        return ts.isStringLiteral(initializer) ? initializer.text : literal(initializer.expression)
      }
      const section = text('section')
      const entityType = text('entityType')
      assert.ok(section && entityType, `${file}: <${name}> must pass literal section and entityType props (the parity test reads them)`)
      const creates = name === 'PendingReviewCountBadge' || (attribute('ids')?.initializer?.getText() ?? '').includes('PENDING_REVIEW_NEW')
      drawn.set(key(section, entityType, creates ? 'creates' : 'record'), `${file} <${name}>`)
    })
  }
  return drawn
}

/** The differences, each worded for the person who just renamed something. */
function mismatches(files: { worker: Record<string, string>; browser: Record<string, string> }): string[] {
  const { queued, appliers } = readWorker(files.worker)
  const drawn = readBrowser(files.browser)
  const problems: string[] = []
  for (const [wanted, where] of queued) {
    if (!drawn.has(wanted)) problems.push(`the Worker can queue ${wanted} (${where}) but no tag draws it`)
  }
  for (const [shown, where] of drawn) {
    if (!queued.has(shown)) problems.push(`${where} draws ${shown} but the Worker never queues it (renamed?)`)
  }
  const queuedPairs = new Set([...queued.keys()].map((entry) => entry.split(':').slice(0, 2).join(':')))
  for (const pair of appliers) {
    if (!queuedPairs.has(pair)) problems.push(`the Worker can approve ${pair} (registerApplier) but no tag draws it`)
  }
  return problems
}

const live = { worker: workerFiles, browser: browserFiles }

test('the parser sees every queue site the Worker has (a positive control, so an empty read cannot pass)', () => {
  const { queued, appliers } = readWorker(workerFiles)
  assert.deepEqual([...queued.keys()].sort(), [
    'branches:branch:record',
    'fees:fee:record',
    'inventory:inventory_reason:creates',
    'products:product:creates',
    'products:product:record',
  ])
  assert.ok(appliers.has('products:product') && appliers.has('fees:fee') && appliers.has('branches:branch') && appliers.has('inventory:inventory_reason'))
  assert.ok(workerFiles['cloudflare/src/lib/productDelete.ts'].includes('INSERT INTO pending_actions'), 'the raw removal inserts are read too')
})

test('the browser draws a tag for every kind of request the Worker can queue, and only for those', () => {
  assert.deepEqual(mismatches(live), [])
  const drawn = readBrowser(browserFiles)
  assert.deepEqual([...drawn.keys()].sort(), [
    'branches:branch:record',
    'fees:fee:record',
    'inventory:inventory_reason:creates',
    'products:product:creates',
    'products:product:record',
  ])
})

// ---- negative controls: a rename on either side, and a new queueable section, must fail ----
function withEdit(files: Record<string, string>, file: string, from: string, to: string, matches = 1): Record<string, string> {
  assert.equal(files[file].split(from).length - 1, matches, `negative control anchor must match ${file} ${matches} time(s): ${from}`)
  return { ...files, [file]: files[file].split(from).join(to) }
}

test('MUTANT the Worker renames an entity type: the tag no longer matches', () => {
  const renamed = withEdit(workerFiles, 'cloudflare/src/routes/fees.ts', "entityType: 'fee',", "entityType: 'expense',")
  const problems = mismatches({ worker: renamed, browser: browserFiles })
  assert.ok(problems.some((problem) => /fees:expense:record .* but no tag draws it/.test(problem)), problems.join('\n'))
  assert.ok(problems.some((problem) => /draws fees:fee:record but the Worker never queues it/.test(problem)), problems.join('\n'))
})

test('MUTANT the browser renames a section: the Worker\'s request is no longer drawn', () => {
  const renamed = withEdit(browserFiles, 'frontend/src/components/branches/Branches.tsx', 'section="branches"', 'section="locations"')
  const problems = mismatches({ worker: workerFiles, browser: renamed })
  assert.ok(problems.some((problem) => /branches:branch:record .* but no tag draws it/.test(problem)), problems.join('\n'))
})

test('MUTANT the Worker starts queueing a new section: nothing draws it', () => {
  const added = withEdit(workerFiles, 'cloudflare/src/routes/fees.ts', "const pendingId = await maybeQueueForReview(c.env, user, 'fees', {", "const pendingId = await maybeQueueForReview(c.env, user, 'contacts', {")
  const problems = mismatches({ worker: added, browser: browserFiles })
  assert.ok(problems.some((problem) => /contacts:fee:record .* but no tag draws it/.test(problem)), problems.join('\n'))
})

test('MUTANT a create loses its null id: the Add button count would no longer match', () => {
  const changed = withEdit(workerFiles, 'cloudflare/src/routes/inventory.ts', "entityType: 'inventory_reason',\n    entityId: null,", "entityType: 'inventory_reason',\n    entityId: 1,")
  const problems = mismatches({ worker: changed, browser: browserFiles })
  assert.ok(problems.some((problem) => /inventory:inventory_reason:record .* but no tag draws it/.test(problem)), problems.join('\n'))
})

test('MUTANT the removal insert is renamed in SQL: the raw INSERT is read too', () => {
  const renamed = withEdit(workerFiles, 'cloudflare/src/lib/productDelete.ts', "VALUES('products','delete','product',@product,@payload,@summary,'open',@actor,@actorName)", "VALUES('products','delete','item',@product,@payload,@summary,'open',@actor,@actorName)", 2)
  const problems = mismatches({ worker: renamed, browser: browserFiles })
  assert.ok(problems.some((problem) => /products:item:record/.test(problem)), problems.join('\n'))
})
