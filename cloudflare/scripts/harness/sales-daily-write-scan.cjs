'use strict'
// The "every writer" scanner of the stored daily sales totals (scripts/test-sales-daily-writer-matrix-native.cjs): finds every SQL write site on a table the
// report kernel reads, in TypeScript source. It replaces a regex comment stripper that treated the `/uploads/*` in a LINE comment (backup.ts:1777) as the
// start of a block comment and hid 490 lines, among them the backup restore's DELETE / INSERT, the one bulk writer of every kernel table.
//
// A real tokenizer: it follows line comments, block comments, single/double-quoted strings, template literals (with nested ${ } code, recursively) and
// regex literals, so a `/*` inside a string or a regex cannot open a comment and a comment cannot hide code. SQL is then looked for ONLY in string and
// template text, never in comments. Writes built by concatenation ('UPDATE ' + t + ' SET ...') are joined into one text, a non-literal part becomes the
// marker \u0001 and reads as a DYNAMIC table. Seen as a table: bare, "quoted", `quoted`, [quoted], main.<table>, "main"."<table>", and a dynamic name
// in any of those forms ("${t}", ${qid(t)}, main.${t}).
// Not seen (stated, so the gap is not hidden): SQL assembled from array joins or separate statements of one string, and SQL read from a file at run time.
const fs = require('node:fs')
const path = require('node:path')

const MARK = '\u0001'
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'in', 'of', 'case', 'delete', 'void', 'throw', 'new', 'else', 'do', 'instanceof', 'yield', 'await'])

/** Every token stream of a source text: the file's own plus one per template expression. Tokens: str {v}, p {v} (+ ; , ( ) [ ] { }), w {v}, o {v}. */
function tokenStreams(src) {
  const n = src.length
  let i = 0
  const streams = []
  const isWordChar = (ch) => /[A-Za-z0-9_$]/.test(ch)

  function readQuoted(quote) {
    i += 1
    let v = ''
    while (i < n) {
      const ch = src[i]
      if (ch === '\\') { v += src[i + 1] ?? ''; i += 2; continue }
      if (ch === quote) { i += 1; break }
      if (ch === '\n') break
      v += ch
      i += 1
    }
    return v
  }
  function readTemplate() {
    i += 1
    let v = ''
    while (i < n) {
      const ch = src[i]
      if (ch === '\\') { v += src[i + 1] ?? ''; i += 2; continue }
      if (ch === '`') { i += 1; break }
      if (ch === '$' && src[i + 1] === '{') { i += 2; v += MARK; code(true); continue }
      v += ch
      i += 1
    }
    return v
  }
  function skipRegex() {
    let at = i + 1
    let inClass = false
    while (at < n) {
      const ch = src[at]
      if (ch === '\n') return false
      if (ch === '\\') { at += 2; continue }
      if (ch === '[') inClass = true
      else if (ch === ']') inClass = false
      else if (ch === '/' && !inClass) { at += 1; while (at < n && /[a-z]/i.test(src[at])) at += 1; i = at; return true }
      at += 1
    }
    return false
  }
  function code(stopAtBrace) {
    const tokens = []
    streams.push(tokens)
    let depth = 0
    const regexAllowed = () => {
      const last = tokens[tokens.length - 1]
      if (!last) return true
      if (last.t === 'str') return false
      if (last.t === 'p') return !(last.v === ')' || last.v === ']' || last.v === '}')
      if (last.t === 'w') return KEYWORDS_BEFORE_REGEX.has(last.v)
      return true
    }
    while (i < n) {
      const c = src[i], d = src[i + 1]
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i += 1; continue }
      if (c === '/' && d === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? n : end + 2; continue }
      if (c === "'" || c === '"') { tokens.push({ t: 'str', v: readQuoted(c) }); continue }
      if (c === '`') { tokens.push({ t: 'str', v: readTemplate() }); continue }
      if (c === '/' && regexAllowed() && skipRegex()) { tokens.push({ t: 'o', v: 're' }); continue }
      if (c === '{') { depth += 1; tokens.push({ t: 'p', v: c }); i += 1; continue }
      if (c === '}') {
        if (stopAtBrace && depth === 0) { i += 1; return }
        depth -= 1
        tokens.push({ t: 'p', v: c })
        i += 1
        continue
      }
      if ('+;,()[]'.includes(c)) { tokens.push({ t: 'p', v: c }); i += 1; continue }
      if (/\s/.test(c)) { i += 1; continue }
      if (isWordChar(c)) { let at = i; while (at < n && isWordChar(src[at])) at += 1; tokens.push({ t: 'w', v: src.slice(i, at) }); i = at; continue }
      tokens.push({ t: 'o', v: c })
      i += 1
    }
  }
  code(false)
  return streams
}

/** The SQL texts of one stream: each string/template literal, with a chain 'a' + expr + 'b' joined into ONE text and the expression read as MARK. */
function sqlTexts(tokens) {
  const texts = []
  const consumed = new Set()
  for (let at = 0; at < tokens.length; at += 1) {
    if (tokens[at].t !== 'str' || consumed.has(at)) continue
    let text = tokens[at].v
    let j = at + 1
    while (tokens[j] && tokens[j].t === 'p' && tokens[j].v === '+') {
      const next = tokens[j + 1]
      if (!next) break
      if (next.t === 'str') { text += next.v; consumed.add(j + 1); j += 2; continue }
      // a non-literal operand: everything up to the next + or the end of the expression at depth 0
      let depth = 0
      let k = j + 1
      let operand = 0
      for (; k < tokens.length; k += 1) {
        const tk = tokens[k]
        if (tk.t === 'p') {
          if (tk.v === '(' || tk.v === '[' || tk.v === '{') depth += 1
          else if (tk.v === ')' || tk.v === ']' || tk.v === '}') { if (depth === 0) break; depth -= 1 }
          else if (depth === 0 && (tk.v === '+' || tk.v === ';' || tk.v === ',')) break
        }
        operand += 1
      }
      if (!operand) break
      text += MARK
      j = k
    }
    texts.push(text)
  }
  return texts
}

/** Tables are named in the order they are written in; `tables` is the kernel's table list. */
function writePatterns(tables) {
  const names = tables.join('|')
  // optional schema (main. / "main".), optional quote, then a kernel table or a dynamic marker, then the closing quote and a word boundary
  const target = `(?:["\`\\[]?main["\`\\]]?\\s*\\.\\s*)?["\`\\[]?(?:(${names})|(${MARK}))["\`\\]]?(?![A-Za-z0-9_])`
  return [
    ['insert', new RegExp(`\\bINSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${target}`, 'gi')],
    ['replace', new RegExp(`(?<!\\bOR\\s+)\\bREPLACE\\s+INTO\\s+${target}`, 'gi')],
    ['update', new RegExp(`\\bUPDATE\\s+(?:OR\\s+\\w+\\s+)?${target}(?:\\s+(?:AS\\s+)?\\w+)?\\s+SET\\b`, 'gi')],
    ['delete', new RegExp(`\\bDELETE\\s+FROM\\s+${target}`, 'gi')],
  ]
}

/** [{ table, verb }] for every write on a kernel table (or a dynamic table) in one source text. */
function scanText(text, tables) {
  const patterns = writePatterns(tables)
  const found = []
  for (const tokens of tokenStreams(text.replace(/\r\n/g, '\n'))) {
    for (const raw of sqlTexts(tokens)) {
      // SQL line comments are not statements
      const sql = raw.replace(/(^|\s)--[^\n]*/g, '$1')
      for (const [verb, pattern] of patterns) for (const m of sql.matchAll(pattern)) found.push({ table: m[1] ? m[1].toLowerCase() : 'DYNAMIC', verb })
    }
  }
  return found
}

/** 'file table verb' -> count, over every .ts file below `root`/src (or the given file map, for the fixtures). */
function scanSource(root, tables, override = new Map()) {
  const found = new Map()
  const add = (file, table, verb) => found.set(`${file} ${table} ${verb}`, (found.get(`${file} ${table} ${verb}`) || 0) + 1)
  const seenFiles = new Set()
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!full.endsWith('.ts')) continue
      const file = path.relative(root, full).replace(/\\/g, '/')
      seenFiles.add(file)
      const text = override.has(file) ? override.get(file) : fs.readFileSync(full, 'utf8')
      for (const site of scanText(text, tables)) add(file, site.table, site.verb)
    }
  }
  walk(path.join(root, 'src'))
  for (const [file, text] of override) if (!seenFiles.has(file)) for (const site of scanText(text, tables)) add(file, site.table, site.verb)
  return found
}

module.exports = { scanText, scanSource, tokenStreams, sqlTexts }
