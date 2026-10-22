// Which of the Worker's four queues a delivered batch came from.
//
// A deployment names its queues <prefix>-import, <prefix>-import-dlq,
// <prefix>-media and <prefix>-backup-assets (wrangler.template.toml,
// QUEUE_PREFIX). The prefix is the client's, so that two clients in one
// Cloudflare account never share a queue: a queue has exactly one consumer
// Worker, and a second Worker consuming the same name would take over the
// first one's imports, media jobs and backups.
//
// The Worker therefore recognises a queue by its ending and not by a literal
// name. A literal name would silently drop every message of a client whose
// prefix differs: Cloudflare delivers the batch, nothing matches, nothing runs.
export type QueueRole = 'import' | 'import-dlq' | 'media' | 'backup-assets'

// Longest ending first: 'x-import-dlq' must not be taken for an import queue.
const ROLES: readonly QueueRole[] = ['import-dlq', 'backup-assets', 'import', 'media']

export function queueRole(queueName: unknown): QueueRole | null {
  if (typeof queueName !== 'string') return null
  for (const role of ROLES) {
    if (queueName.length > role.length + 1 && queueName.endsWith(`-${role}`)) return role
  }
  return null
}
