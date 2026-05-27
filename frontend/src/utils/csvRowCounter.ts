export function countCsvDataRows(text: unknown): number {
  const source = String(text || '')
  let recordCount = 0
  let recordHasContent = false
  let inQuotes = false

  const finishRecord = () => {
    if (recordHasContent) recordCount += 1
    recordHasContent = false
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const nextChar = source[index + 1]

    if (char === '"' && inQuotes && nextChar === '"') {
      recordHasContent = true
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      recordHasContent = true
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1
      finishRecord()
      continue
    }

    if (char.trim()) recordHasContent = true
  }

  finishRecord()
  return Math.max(0, recordCount - 1)
}
