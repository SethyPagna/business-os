// Extracts every apiFetch(METHOD, path, body?) call from frontend/src/api/*.ts.
// Heuristic regex pass (same spirit/caveats as extract_backend_routes.cjs).
const fs = require('fs')
const path = require('path')

const API_DIR = path.join(__dirname, '..', 'business-os-v1', 'frontend', 'src', 'api')

function findMatchingParen(src, openIdx, openChar, closeChar) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === openChar) depth++
    else if (src[i] === closeChar) { depth--; if (depth === 0) return i }
  }
  return -1
}

// Normalize a path template's dynamic segments (`${...}`) to `:param` so it
// can be compared against a backend `:id`-style path.
function normalizeTemplatePath(raw) {
  // Strip surrounding quotes/backticks first.
  let s = raw.trim()
  const quote = s[0]
  if (quote === "'" || quote === '"' || quote === '`') {
    s = s.slice(1, -1)
  } else {
    // Not a simple literal (e.g. a function call building the path) --
    // return null to mark as "opaque", handled separately.
    return null
  }
  // Resolve ${...} interpolations first -- a literal '?' can appear inside
  // one (e.g. a ternary building a query string), so splitting on '?' before
  // this step truncates the path mid-expression.
  s = s.replace(/\$\{[^}]*\}/g, ':param')
  // Drop query string for path matching purposes.
  s = s.split('?')[0]
  return s
}

function extractCallsFromFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8')
  const calls = []
  const re = /apiFetch\(\s*'([A-Z]+)'\s*,\s*/g
  let m
  while ((m = re.exec(src))) {
    const method = m[1]
    const afterMethod = m.index + m[0].length
    // The path argument starts here -- it's either a quoted literal or a
    // template literal or a function call. Find its extent by scanning to
    // the next top-level comma or closing paren of the apiFetch(...) call.
    // Find the apiFetch( opening paren (just before m[0] ends at the comma
    // after method) -- easier: locate the '(' that started this apiFetch call.
    const openParenIdx = src.lastIndexOf('(', m.index + 'apiFetch'.length + 1)
    const closeParenIdx = findMatchingParen(src, openParenIdx, '(', ')')
    const fullArgs = closeParenIdx !== -1 ? src.slice(openParenIdx + 1, closeParenIdx) : ''
    // Split top-level args by comma (respecting nesting/strings/template literals).
    const args = splitTopLevelArgs(fullArgs)
    const pathArgRaw = (args[1] || '').trim()
    const bodyArgRaw = (args[2] || '').trim()
    const normalizedPath = normalizeTemplatePath(pathArgRaw)
    calls.push({
      file: path.basename(filePath),
      method,
      pathRaw: pathArgRaw,
      pathNormalized: normalizedPath,
      bodyRaw: bodyArgRaw ? (bodyArgRaw.length > 200 ? bodyArgRaw.slice(0, 200) + '...' : bodyArgRaw) : null,
      bodyKeys: bodyArgRaw.startsWith('{') ? extractTopLevelKeys(bodyArgRaw) : null,
    })
  }
  return calls
}

function splitTopLevelArgs(argsSrc) {
  const parts = []
  let depth = 0
  let tokenStart = 0
  let inString = null
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
    else if (ch === ',' && depth === 0) {
      parts.push(argsSrc.slice(tokenStart, i))
      tokenStart = i + 1
    }
  }
  parts.push(argsSrc.slice(tokenStart))
  return parts
}

function extractTopLevelKeys(objSrc) {
  const trimmed = objSrc.trim()
  if (!trimmed.startsWith('{')) return null
  const closeIdx = findMatchingParen(trimmed, 0, '{', '}')
  const inner = closeIdx !== -1 ? trimmed.slice(1, closeIdx) : trimmed.slice(1, -1)
  const keys = []
  let depth = 0
  let tokenStart = 0
  let inString = null
  const n = inner.length
  function push(raw) {
    const t = raw.trim()
    if (!t) return
    if (t.startsWith('...')) { keys.push(t.slice(0, 40)); return }
    const km = t.match(/^(?:'([^']+)'|"([^"]+)"|\[([^\]]+)\]|([A-Za-z_$][\w$]*))\s*:/)
    if (km) { keys.push(km[1] || km[2] || km[3] || km[4]); return }
    const shortM = t.match(/^([A-Za-z_$][\w$]*)$/)
    if (shortM) { keys.push(shortM[1]); return }
  }
  for (let i = 0; i < n; i++) {
    const ch = inner[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { inString = ch; continue }
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) { push(inner.slice(tokenStart, i)); tokenStart = i + 1 }
  }
  push(inner.slice(tokenStart))
  return keys
}

function main() {
  const files = fs.readdirSync(API_DIR).filter((f) => f.endsWith('.ts'))
  const allCalls = []
  for (const f of files) {
    allCalls.push(...extractCallsFromFile(path.join(API_DIR, f)))
  }
  fs.writeFileSync(path.join(__dirname, 'frontend_calls.json'), JSON.stringify(allCalls, null, 2))
  console.log(`Extracted ${allCalls.length} frontend apiFetch call sites -> frontend_calls.json`)
}

main()
