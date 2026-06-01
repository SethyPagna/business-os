import { decodeTextBuffer } from '../utils/csvImport.ts'

export type CsvDialogResult = {
  content: string
  name: string
}

export function openCSVDialog(): Promise<CsvDialogResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,.tsv,text/csv,text/tab-separated-values'
    input.onchange = async (event) => {
      const target = event.target as HTMLInputElement | null
      const file = target?.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const content = decodeTextBuffer(await file.arrayBuffer())
      resolve({ content, name: file.name })
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
