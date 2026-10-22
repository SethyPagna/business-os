// Which consumer a queue batch belongs to, from the queue's name. Each
// deployment names its own queues (business-os-import, bmshop-import, ...),
// so the role is the name's suffix, never the whole name. The dead-letter
// suffix is checked first: 'x-import-dlq' must not read as 'x-import'.
export type QueueRole = 'import-dlq' | 'import' | 'media' | 'backup-assets'

const ROLES_BY_SUFFIX: readonly QueueRole[] = ['import-dlq', 'import', 'media', 'backup-assets']

export function queueRole(queueName: unknown): QueueRole | null {
  const name = String(queueName || '')
  return ROLES_BY_SUFFIX.find((role) => name === role || name.endsWith(`-${role}`)) ?? null
}
