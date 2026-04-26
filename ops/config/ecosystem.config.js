'use strict'
/**
 * ecosystem.config.js — PM2 process configuration for Business OS.
 *
 * Usage:
 *   pm2 start ecosystem.config.js          # start
 *   pm2 reload ecosystem.config.js         # zero-downtime reload
 *   pm2 stop business-os                   # stop
 *   pm2 logs business-os                   # live logs
 *   pm2 save && pm2 startup                # auto-start on boot
 *
 * Node 24 notes:
 *   - `--max-old-space-size` is still valid in Node 24.
 *   - `--no-deprecation` suppresses any remaining deprecation warnings from
 *     transitive dependencies (e.g. old util.isBuffer calls in minor libs).
 *     Remove it if you want to see those warnings during dev.
 *   - `watch: false` — never enable file watching in production.
 *
 * KEY PM2 BEHAVIOUR:
 *   - `cwd` is set to the project root so relative paths in .env work correctly.
 *   - `script` uses an absolute path so PM2 can be started from ANY directory.
 */

const path = require('path')

const PROJECT_ROOT = __dirname

module.exports = {
  apps: [
    {
      name:    'business-os',
      script:  path.join(PROJECT_ROOT, 'backend', 'server.js'),
      cwd:     PROJECT_ROOT,

      env: {
        NODE_ENV: 'production',
        PORT:     4000,
      },

      // Node 24: --max-old-space-size still works; --no-deprecation silences
      // any noisy transitive-dep warnings without affecting functionality.
      node_args: '--max-old-space-size=512 --no-deprecation',

      // Restart behaviour
      restart_delay:     3000,
      max_restarts:      10,
      min_uptime:        '10s',
      exp_backoff_restart_delay: 100,

      watch: false,
      ignore_watch: ['node_modules', 'data', 'frontend/dist'],

      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file:   path.join(PROJECT_ROOT, 'logs', 'out.log'),
      error_file: path.join(PROJECT_ROOT, 'logs', 'error.log'),
      merge_logs: true,

      instances: 1,
      exec_mode: 'fork',
    },
  ],
}
