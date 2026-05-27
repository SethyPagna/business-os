export function buildCSV(rows?: unknown[]): string
export function buildZip(files?: Array<{ name?: string; filename?: string; content?: string; rows?: unknown[] }>): Blob | null
export function buildZipInWorker(files?: Array<{ name?: string; filename?: string; content?: string; rows?: unknown[] }>, options?: { timeoutMs?: number }): Promise<Blob | null>
export function downloadBlob(filename: string, blob: Blob): void
export function downloadCSV(filename: string, rows?: unknown[]): void
export function downloadZipFiles(filename: string, files?: Array<{ name?: string; filename?: string; content?: string; rows?: unknown[] }>): void
export function downloadZipFilesAsync(filename: string, files?: Array<{ name?: string; filename?: string; content?: string; rows?: unknown[] }>, options?: { timeoutMs?: number }): Promise<void>
