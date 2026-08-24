// Extracts every app.<method>(path, handler) route from cloudflare/src/routes/*.ts,
// plus a best-effort list of:
//   - request body fields read (via c.req.json() destructure or body.xxx / payload.xxx access)
//   - response JSON top-level keys emitted (via c.json({...}))
// This is a heuristic regex/brace-matching pass, not a real TS AST walk -- same
// "replicate/inspect the real source directly" spirit as this repo's own
// scripts/test-search-500-repro.cjs, just applied to shape extraction instead
// of SQL. Output is intentionally verbose/JSON so a human (or a second pass)
// can sanity-check every entry rather than trusting a black-box "diff clean".
const fs = require('fs')
const path = require('path')

const ROUTES_DIR = path.join(__dirname, '..', 'business-os-v1', 'cloudflare', 'src', 'routes')
const INDEX_PATH = path.join(__dirname, '..', 'business-os-v1', 'cloudflare', 'src', 'index.ts')

// Build filename -> mount prefix map from index.ts's app.route() calls.
function loadMountPrefixes() {
  const src = fs.readFileSync(INDEX_PATH, 'utf8')
  const importMap = {} // localName -> './routes/xxx'
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/(\w+)'/g)) {
    importMap[m[1]] = m[2]
  }
  // createSyncRoute(app) special-cased separately (sync.ts)
  const prefixes = {} // routeFileBase -> mount prefix
  for (const m of src.matchAll(/app\.route\('([^']+)',\s*(\w+)/g)) {
    const [, prefix, localName] = m
    const fileBase = importMap[localName]
    if (fileBase) prefixes[fileBase] = prefix
  }
  if (/createSyncRoute/.test(src)) prefixes['sync'] = '/api/sync'
  return prefixes
}

function findMatchingBrace(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// Extract top-level keys from an object-literal source fragment (between { and }),
// ignoring nested braces/brackets/parens and string contents. Best-effort --
// spread (...x) entries are recorded as '...x' rather than expanded.
function extractTopLevelKeys(objSrc) {
  const keys = []
  let depth = 0
  let i = 0
  let tokenStart = 0
  const n = objSrc.length
  function pushToken(raw) {
    const trimmed = raw.trim()
    if (!trimmed) return
    if (trimmed.startsWith('...')) { keys.push(trimmed.slice(0, 40)); return }
    const km = trimmed.match(/^(?:'([^']+)'|"([^"]+)"|\[([^\]]+)\]|([A-Za-z_$][\w$]*))\s*:/)
    if (km) { keys.push(km[1] || km[2] || km[3] || km[4]); return }
    // shorthand property (no colon) -- e.g. `{ id, name }`
    const shortM = trimmed.match(/^([A-Za-z_$][\w$]*)$/)
    if (shortM) { keys.push(shortM[1]); return }
  }
  while (i < n) {
    const ch = objSrc[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < n && objSrc[i] !== quote) { if (objSrc[i] === '\\') i++; i++ }
      i++
      continue
    }
    if (ch === '{' || ch === '(' || ch === '[') { depth++; i++; continue }
    if (ch === '}' || ch === ')' || ch === ']') { depth--; i++; continue }
    if (ch === ',' && depth === 0) {
      pushToken(objSrc.slice(tokenStart, i))
      tokenStart = i + 1
    }
    i++
  }
  pushToken(objSrc.slice(tokenStart, n))
  return keys
}

function extractResponseKeysForHandler(handlerSrc) {
  const results = []
  const re = /c\.json\(/g
  let m
  while ((m = re.exec(handlerSrc))) {
    const parenOpen = m.index + m[0].length - 1
    const parenClose = findMatchingBrace === null ? -1 : (() => {
      let depth = 0
      for (let i = parenOpen; i < handlerSrc.length; i++) {
        if (handlerSrc[i] === '(') depth++
        else if (handlerSrc[i] === ')') { depth--; if (depth === 0) return i }
      }
      return -1
    })()
    if (parenClose === -1) continue
    const argsSrc = handlerSrc.slice(parenOpen + 1, parenClose)
    // First argument only (status code / init may follow) -- split on the
    // top-level comma that separates the payload from a trailing status arg.
    let depth = 0
    let splitIdx = argsSrc.length
    for (let i = 0; i < argsSrc.length; i++) {
      const ch = argsSrc[i]
      if (ch === '{' || ch === '(' || ch === '[') depth++
      else if (ch === '}' || ch === ')' || ch === ']') depth--
      else if (ch === ',' && depth === 0) { splitIdx = i; break }
    }
    const payloadSrc = argsSrc.slice(0, splitIdx).trim()
    if (payloadSrc.startsWith('{')) {
      const innerClose = findMatchingBrace(payloadSrc, 0)
      const inner = innerClose !== -1 ? payloadSrc.slice(1, innerClose) : payloadSrc.slice(1, -1)
      results.push({ keys: extractTopLevelKeys(inner), raw: payloadSrc.length > 300 ? payloadSrc.slice(0, 300) + '...' : payloadSrc })
    } else {
      // c.json(someVariable) or c.json(await something()) -- can't get keys
      // without real type info; record as opaque.
      results.push({ keys: null, raw: payloadSrc.length > 120 ? payloadSrc.slice(0, 120) + '...' : payloadSrc })
    }
  }
  return results
}

function extractRequestBodyFields(handlerSrc) {
  const fields = new Set()
  // Pattern 1: const { a, b, c } = await c.req.json()
  const destructureRe = /(?:const|let)\s*\{([^}]+)\}\s*=\s*await\s+c\.req\.json(?:<[^>]*>)?\(\)/g
  let m
  while ((m = destructureRe.exec(handlerSrc))) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(':')[0].trim().replace(/^\.\.\./, '')
      if (name) fields.add(name)
    }
  }
  // Pattern 2: const body = await c.req.json(); ... body.xxx / body['xxx']
  const bodyVarRe = /(?:const|let)\s+(\w+)\s*=\s*await\s+c\.req\.json(?:<[^>]*>)?\(\)/g
  const bodyVars = new Set()
  while ((m = bodyVarRe.exec(handlerSrc))) bodyVars.add(m[1])
  for (const varName of bodyVars) {
    const accessRe = new RegExp(`\\b${varName}\\.(\\w+)`, 'g')
    let am
    while ((am = accessRe.exec(handlerSrc))) fields.add(am[1])
    const bracketRe = new RegExp(`\\b${varName}\\['([^']+)'\\]`, 'g')
    while ((am = bracketRe.exec(handlerSrc))) fields.add(am[1])
  }
  return [...fields].sort()
}

// Given the args-list source of an app.<method>(...) call (everything
// between its outer parens), return the source of the handler's body --
// block-bodied (`(c) => { ... }`) or concise (`(c) => expr`) -- by taking
// the last top-level comma-separated argument (skipping any middleware
// args before it) and locating its `=>`.
function extractHandlerBody(argsSrc) {
  const args = []
  let depth = 0, tokenStart = 0, inString = null
  for (let i = 0; i < argsSrc.length; i++) {
    const ch = argsSrc[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue }
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) { args.push(argsSrc.slice(tokenStart, i)); tokenStart = i + 1 }
  }
  args.push(argsSrc.slice(tokenStart))
  const handlerArg = args[args.length - 1]
  const arrowIdx = handlerArg.indexOf('=>')
  if (arrowIdx === -1) return null
  let body = handlerArg.slice(arrowIdx + 2).trim()
  if (body.startsWith('{')) {
    const closeIdx = findMatchingBrace(body, 0)
    return closeIdx !== -1 ? body.slice(0, closeIdx + 1) : body
  }
  return body // concise-body arrow expression
}

function extractRoutesFromFile(filePath, mountPrefix) {
  const src = fs.readFileSync(filePath, 'utf8')
  const routes = []
  const routeRe = /\bapp\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2\s*,/g
  let m
  while ((m = routeRe.exec(src))) {
    const [, method, , routePath] = m
    // Locate the call's outer parens (start at "app." right before the
    // matched method) so middleware-prefixed and concise-body handlers are
    // both captured correctly, not just the block-body `{ ... }` case.
    const callStart = src.lastIndexOf('app.', m.index + 4)
    const openParenIdx = src.indexOf('(', callStart)
    const closeParenIdx = findMatchingParen(src, openParenIdx)
    if (closeParenIdx === -1) continue
    const fullArgsSrc = src.slice(openParenIdx + 1, closeParenIdx)
    // Drop the leading path-literal arg (and its trailing comma) before
    // splitting into middleware/handler args.
    const pathArgEnd = fullArgsSrc.indexOf(',') + 1
    const restArgsSrc = fullArgsSrc.slice(pathArgEnd)
    const handlerSrc = extractHandlerBody(restArgsSrc)
    if (handlerSrc === null) continue
    const fullPath = (mountPrefix || '') + (routePath === '/' ? '' : routePath)
    routes.push({
      file: path.basename(filePath),
      method: method.toUpperCase(),
      path: fullPath || '/',
      requestBodyFields: extractRequestBodyFields(handlerSrc),
      responsePayloads: extractResponseKeysForHandler(handlerSrc),
    })
  }
  return routes
}

function findMatchingParen(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}

function main() {
  const prefixes = loadMountPrefixes()
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'))
  const allRoutes = []
  for (const f of files) {
    const base = f.replace(/\.ts$/, '')
    const prefix = prefixes[base] ?? ''
    if (!(base in prefixes)) {
      console.error(`WARN: no mount prefix found for routes/${f} -- skipping (probably not mounted, or mounted via a re-export)`)
      continue
    }
    allRoutes.push(...extractRoutesFromFile(path.join(ROUTES_DIR, f), prefix))
  }
  fs.writeFileSync(path.join(__dirname, 'backend_routes.json'), JSON.stringify(allRoutes, null, 2))
  console.log(`Extracted ${allRoutes.length} backend routes -> backend_routes.json`)
}

main()
