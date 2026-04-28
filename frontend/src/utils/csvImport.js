export function splitCsvLine(line) {
  const result = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
      continue
    }

    current += char
  }

  result.push(current)
  return result
}

export function parseCsvRows(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []

  const headers = splitCsvLine(lines[0])
    .map((value) => String(value || '').trim().replace(/^"|"$/g, '').toLowerCase())

  return lines
    .slice(1)
    .map((line) => {
      const values = splitCsvLine(line)
      const row = {}
      headers.forEach((header, index) => {
        row[header] = String(values[index] || '').trim().replace(/^"|"$/g, '')
      })
      return row
    })
    .filter((row) => Object.values(row).some(Boolean))
}

export function normalizeCsvKey(value) {
  return String(value || '').trim().toLowerCase()
}

export function parseCsvNumber(value, fallback = 0) {
  const numeric = parseFloat(value)
  return Number.isFinite(numeric) ? numeric : fallback
}
