// Matches frontend apiFetch call sites to backend routes by method+path
// (params normalized to :param on both sides), then diffs request-body
// field usage: fields the frontend sends vs fields the backend handler
// actually reads. Heuristic, same caveats as the two extractor scripts.
const fs = require('fs')

const backend = JSON.parse(fs.readFileSync('backend_routes.json', 'utf8'))
const frontend = JSON.parse(fs.readFileSync('frontend_calls.json', 'utf8'))

function normalizeBackendPath(p) {
  // /api/products/:id -> /api/products/:param  (align param style with frontend normalizer)
  return p.replace(/:[A-Za-z_][\w]*/g, ':param')
}

const backendIndex = new Map() // "METHOD path" -> route
for (const r of backend) {
  const key = r.method + ' ' + normalizeBackendPath(r.path)
  if (!backendIndex.has(key)) backendIndex.set(key, [])
  backendIndex.get(key).push(r)
}

const results = {
  unmatched_frontend_calls: [],   // frontend call with no backend route at all
  opaque_frontend_paths: [],      // frontend path built dynamically, couldn't normalize
  request_body_mismatches: [],    // matched, but body keys differ
  clean_matches: 0,
  total_frontend_calls: frontend.length,
}

for (const call of frontend) {
  if (call.pathNormalized === null) {
    results.opaque_frontend_paths.push({ file: call.file, method: call.method, pathRaw: call.pathRaw })
    continue
  }
  const key = call.method + ' ' + call.pathNormalized
  const matches = backendIndex.get(key)
  if (!matches || matches.length === 0) {
    results.unmatched_frontend_calls.push({ file: call.file, method: call.method, path: call.pathNormalized })
    continue
  }
  // Compare against every candidate route with this method+path (usually 1).
  let anyClean = false
  const hasSpread = call.bodyKeys && call.bodyKeys.some(k => k.startsWith('...'))
  for (const route of matches) {
    if (hasSpread) {
      // A spread (...helperFn(), ...payload) means the real sent field set
      // can't be known without tracing the spread source -- skip rather than
      // report every backend-read field as "not sent" (false positive).
      results.spread_bodies_skipped = (results.spread_bodies_skipped || 0) + 1
      anyClean = true
      continue
    }
    if (call.bodyKeys && route.requestBodyFields) {
      const sent = new Set(call.bodyKeys.filter(k => !k.startsWith('...')))
      const read = new Set(route.requestBodyFields)
      const sentNotRead = [...sent].filter(k => !read.has(k))
      const readNotSent = [...read].filter(k => !sent.has(k))
      if (sentNotRead.length === 0 && readNotSent.length === 0) {
        anyClean = true
      } else {
        results.request_body_mismatches.push({
          frontendFile: call.file, backendFile: route.file,
          method: call.method, path: call.pathNormalized,
          sentButNotRead: sentNotRead, readButNotSent: readNotSent,
        })
      }
    } else {
      anyClean = true // can't compare (opaque body on either side) -- not a flagged mismatch
    }
  }
  if (anyClean) results.clean_matches++
}

fs.writeFileSync('contract_diff.json', JSON.stringify(results, null, 2))
console.log(`Frontend calls: ${frontend.length}`)
console.log(`Unmatched (no backend route): ${results.unmatched_frontend_calls.length}`)
console.log(`Opaque path (dynamic, skipped): ${results.opaque_frontend_paths.length}`)
console.log(`Clean matches: ${results.clean_matches}`)
console.log(`Body-shape mismatches: ${results.request_body_mismatches.length}`)
