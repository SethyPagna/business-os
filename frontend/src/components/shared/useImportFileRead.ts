import { useEffect, useState, useSyncExternalStore } from 'react'
import { createImportFileReadGate } from '../../utils/importFileReadGate.ts'
import { isImportFileReadInFlight, subscribeToImportFileReads } from '../../utils/spreadsheetImport.ts'

export function useImportFileRead() {
  const readingFile = useSyncExternalStore(subscribeToImportFileReads, isImportFileReadInFlight)
  const [gate] = useState(createImportFileReadGate)
  useEffect(() => gate.cancel, [gate])
  return { readingFile, read: gate.read, cancel: gate.cancel }
}
