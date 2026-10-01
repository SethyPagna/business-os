function sqliteD1Call(statement, method, values) {
  const sql = statement.sourceSQL ?? statement.source
  const numbered = new Set()
  const names = new Map()
  let slots = 0
  for (let i = 0; i < sql.length;) {
    const char = sql[i]
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const end = char === '[' ? ']' : char
      i++
      while (i < sql.length) {
        if (sql[i++] !== end) continue
        if (char !== '[' && sql[i] === end) { i++; continue }
        break
      }
      continue
    }
    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i + 2)
      i = end < 0 ? sql.length : end + 1
      continue
    }
    if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? sql.length : end + 2
      continue
    }
    if (char !== '?') { i++; continue }
    const start = ++i
    while (i < sql.length && /[0-9]/.test(sql[i])) i++
    if (i === start) slots++
    else {
      const name = sql.slice(start, i)
      const slot = Number(name)
      numbered.add(slot)
      names.set(name, slot)
      slots = Math.max(slots, slot)
    }
  }
  if (slots > 100 || values.length > 100) throw new Error('D1_ERROR: too many SQL variables')
  if (!numbered.size) return statement[method](...values)
  if (values.length !== slots) throw new Error(`D1 parameter count mismatch: expected ${slots}, got ${values.length}`)
  if (statement.sourceSQL !== undefined) return statement[method](...values)
  const named = Object.fromEntries([...names].map(([name, slot]) => [name, values[slot - 1]]))
  const anonymous = values.filter((_, i) => !numbered.has(i + 1))
  return statement[method](named, ...anonymous)
}

module.exports = { sqliteD1Call }
