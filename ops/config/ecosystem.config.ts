'use strict'
/**
 * ecosystem.config.js - PM2 process configuration for Business OS.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 reload ecosystem.config.js
 *   pm2 stop business-os
 *   pm2 logs business-os
 *   pm2 save && pm2 startup
 *
 * The generated ecosystem.config.js filename is retained because PM2 and the
 * Linux launcher load it directly.
 */

type NodePath = typeof import('node:path')

declare const require: (moduleName: 'path') => NodePath
declare const __dirname: string
declare const module: { exports: Pm2Config }

type EnvValue = string | number
type RuntimeMode = 'fork'

type Pm2App = {
  name: string
  script: string
  cwd: string
  env: Record<string, EnvValue>
  node_args: string
  restart_delay: number
  max_restarts: number
  min_uptime: string
  exp_backoff_restart_delay: number
  watch: false
  ignore_watch: string[]
  log_date_format: string
  out_file: string
  error_file: string
  merge_logs: boolean
  instances: number
  exec_mode: RuntimeMode
}

type Pm2Config = {
  apps: Pm2App[]
}

type ProcessConfigOptions = {
  name: string
  scriptParts: string[]
  memoryMb: number
  outputLogName: string
  errorLogName: string
}

const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const DEFAULT_RESTART_DELAY_MS = 3000
const MAX_RESTARTS = 10
const MIN_UPTIME = '10s'
const EXPONENTIAL_BACKOFF_DELAY_MS = 100
const LOG_DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss'
const IGNORED_WATCH_PATHS = ['node_modules', 'data', 'frontend/dist']

const DEFAULT_ENV: Record<string, EnvValue> = {
  NODE_ENV: 'production',
  PORT: 4000,
  BUSINESS_OS_REQUIRE_SCALE_SERVICES: '1',
  JOB_QUEUE_DRIVER: 'bullmq',
  WORKER_RUNTIME: 'host',
  REDIS_URL: 'redis://127.0.0.1:6379',
  RUNTIME_CACHE_ENABLED: '1',
  CACHE_REDIS_URL: 'redis://127.0.0.1:6380',
  DATABASE_DRIVER: 'postgres',
  OBJECT_STORAGE_DRIVER: 'r2',
  ANALYTICS_ENGINE: 'duckdb',
  PARQUET_STORE: 'r2',
  IMPORT_QUEUE_CONCURRENCY: '1',
  MEDIA_QUEUE_CONCURRENCY: '4',
  IMPORT_ROW_BATCH_SIZE: '400',
  IMPORT_BATCH_PAUSE_MS: '20',
  IMPORT_IMAGE_CONCURRENCY: '4',
  UPLOAD_CHUNK_MB: '12',
}

function createProcessConfig(options: ProcessConfigOptions): Pm2App {
  return {
    name: options.name,
    script: path.join(PROJECT_ROOT, ...options.scriptParts),
    cwd: PROJECT_ROOT,
    env: DEFAULT_ENV,
    node_args: `--max-old-space-size=${options.memoryMb} --no-deprecation`,
    restart_delay: DEFAULT_RESTART_DELAY_MS,
    max_restarts: MAX_RESTARTS,
    min_uptime: MIN_UPTIME,
    exp_backoff_restart_delay: EXPONENTIAL_BACKOFF_DELAY_MS,
    watch: false,
    ignore_watch: IGNORED_WATCH_PATHS,
    log_date_format: LOG_DATE_FORMAT,
    out_file: path.join(PROJECT_ROOT, 'logs', options.outputLogName),
    error_file: path.join(PROJECT_ROOT, 'logs', options.errorLogName),
    merge_logs: true,
    instances: 1,
    exec_mode: 'fork',
  }
}

const config: Pm2Config = {
  apps: [
    createProcessConfig({
      name: 'business-os',
      scriptParts: ['backend', 'server.js'],
      memoryMb: 512,
      outputLogName: 'out.log',
      errorLogName: 'error.log',
    }),
    createProcessConfig({
      name: 'business-os-import-worker',
      scriptParts: ['backend', 'src', 'workers', 'importWorker.ts'],
      memoryMb: 768,
      outputLogName: 'import-worker.out.log',
      errorLogName: 'import-worker.error.log',
    }),
    createProcessConfig({
      name: 'business-os-media-worker',
      scriptParts: ['backend', 'src', 'workers', 'mediaWorker.ts'],
      memoryMb: 1024,
      outputLogName: 'media-worker.out.log',
      errorLogName: 'media-worker.error.log',
    }),
  ],
}

module.exports = config
