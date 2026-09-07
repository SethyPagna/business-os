export function mergeDuplicateChunkRequiresManualResume<T extends { interrupted?: unknown }>(
  result: T | null | undefined,
): result is T & { interrupted: true } {
  return result?.interrupted === true
}
