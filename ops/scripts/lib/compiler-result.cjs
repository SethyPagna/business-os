'use strict'

// tsc --pretty false, --noEmit and the unused flags only. Keep compiler/process
// failures distinct from the declaration budget: zero parsed errors is not
// evidence that a compiler actually ran successfully.
const UNUSED_CODES = new Set([6133, 6138, 6192, 6196, 6198, 6199])

function unusedCompilerDiagnostics(result) {
  if (!result || result.error) throw new Error(`Compiler failed to start or complete: ${result?.error?.message || 'missing result'}`)
  if (result.signal) throw new Error(`Compiler terminated by signal: ${result.signal}`)
  // TypeScript uses 1 for diagnostics with skipped output and 2 for diagnostics
  // with completed output processing (including the current --noEmit path).
  if (![0, 1, 2].includes(result.status)) throw new Error(`Unexpected compiler exit status: ${result.status}`)
  if (typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw new Error('Compiler output was not captured as text')
  if (result.stderr.trim()) throw new Error(`Unexpected compiler stderr:\n${result.stderr}`)
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim())
  for (const line of lines) {
    const diagnostic = /^.+\(\d+,\d+\): error TS(\d+): .+$/.exec(line)
    if (!diagnostic || !UNUSED_CODES.has(Number(diagnostic[1]))) throw new Error(`Unexpected compiler output or diagnostic:\n${line}`)
  }
  if ((result.status === 0) !== (lines.length === 0)) {
    throw new Error(`Inconsistent compiler status/output: exit ${result.status}, ${lines.length} diagnostic(s)`)
  }
  return lines
}

module.exports = { unusedCompilerDiagnostics }
