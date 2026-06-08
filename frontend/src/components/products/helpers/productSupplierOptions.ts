export function buildProductSupplierOptions(metaSuppliers: unknown[] = []): string[] {
  return [...new Set((metaSuppliers || []).filter(Boolean).map((supplier) => String(supplier)))].sort((a, b) => a.localeCompare(b))
}
