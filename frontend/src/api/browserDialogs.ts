import { parseImportFile } from '../utils/spreadsheetImport.ts'

export type CsvDialogResult = {
  content: string
  name: string
}

// Accepts real Excel workbooks alongside CSV/TSV -- parseImportFile detects
// which one it got by extension and returns the same { content, name }
// shape either way (see spreadsheetImport.ts for why Excel needed real
// binary parsing rather than being read as text like CSV/TSV are).
export const IMPORT_FILE_ACCEPT = '.csv,.tsv,.xlsx,.xls,.xlsm,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'

export function openCSVDialog(): Promise<CsvDialogResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = IMPORT_FILE_ACCEPT
    input.onchange = async (event) => {
      const target = event.target as HTMLInputElement | null
      const file = target?.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      resolve(await parseImportFile(file))
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export function openImageDialog(): Promise<null> {
  return Promise.resolve(null)
}

export function getImageDataUrl(_path: string): Promise<null> {
  return Promise.resolve(null)
}
