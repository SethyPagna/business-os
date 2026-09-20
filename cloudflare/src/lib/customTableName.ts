/** Validate stored identifiers, never sanitize them into a different target.
 * Historical customTables.ts (d3469ecf through eaa02af6's parent) emitted
 * ct_ + at most 40 lower-case ASCII word characters. Its sanitizer could
 * produce bare ct_, digit-leading and underscore-only suffixes: retain them.
 * This reserved namespace, not a list of today's system tables, protects
 * future generation/retirement ledgers from restored metadata too. */
export function assertCustomTableName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.startsWith('ct_') || name.length > 43 || /[^a-z0-9_]/.test(name.slice(3))) {
    throw new Error('Invalid custom table metadata: expected a historical ct_ table identifier. No custom tables may be dropped from this metadata.')
  }
}
