// Ids of the rotating-cron steps, in rotation order. Shared by the Worker
// entry (which builds the steps) and GET /api/runtime/cron-health (which
// reports on them) without dragging the whole entry module into the route.
// scripts/test-cron-rotation-pure.cjs pins this list to cronRotationSteps()
// in src/index.ts and to EPHEMERAL_RETENTION_GROUPS.
export const ROTATION_STEP_IDS: readonly string[] = [
  'drive-sync',
  'audit-log-retention',
  'reap-stalled-imports',
  'import-retention',
  'import-incoming-sweep',
  'orphan-staging-cleanup',
  'ephemeral-retention:rate_limit',
  'ephemeral-retention:auth',
  'ephemeral-retention:logs',
  'ephemeral-retention:history',
  'ephemeral-retention:submissions',
]

/** The heavy trigger's steps (CRON_HEAVY), in order; see cronHeavySteps() in src/index.ts. */
export const HEAVY_STEP_IDS: readonly string[] = ['backup', 'image-audit']
