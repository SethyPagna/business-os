// Every number and name the weekly backup and the post-deploy pack share, written once. Tests pin the workflow and the packs to these.

export const WEEKLY_SCHEDULE_UTC = '30 20 * * 0'
export const WEEKLY_RETRY_UTC = '30 20 * * 1'
export const WEEKLY_KEEP = 4
export const WEEKLY_FRESH_DAYS = 6
export const WEEKLY_PREFIX = 'backups/weekly/'
export const WEEKLY_MARKER_KEY = `${WEEKLY_PREFIX}latest.json`
export const WEEKLY_ENABLED_VARIABLE = 'WEEKLY_BACKUP_ENABLED'

export const EXPORT_MAX_ROWS_READ = 600000
export const ANCHOR_PACK = 'recent'

export const POSTFLIGHT_MAX_ROWS_READ = 150000
export const POSTFLIGHT_FILE_MAX_ROWS_READ = 50000

export const FREE_DAY_ROWS_READ = 5000000
export const FREE_DAY_MARGIN = 250000
export const NODE_PIN = '24.22.2'
