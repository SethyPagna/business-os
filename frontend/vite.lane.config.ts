import base from './vite.config'
import type { UserConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

// Dev-server config for previewing a LANE WORKTREE, not the primary checkout.
//
// Why this file exists. The preview pane resolves `.claude/launch.json` against
// the primary working directory, so the stock `frontend` entry (`npm run dev
// --prefix frontend`) always serves C:/Users/mrkl6/Downloads/business-os-v1 --
// the shared checkout -- no matter which worktree the work is in. A lane that
// screenshotted its layout work through it was photographing someone else's
// tree while believing it had photographed its own. That failure is silent and
// looks exactly like success, so a whole round of UI lanes shipped with source
// assertions and no visual verification rather than risk a misleading picture.
//
// The `frontend-lane` entry in launch.json passes an ABSOLUTE prefix into
// bos-rc-workers/lane-preview -- a junction the coordinator points at whichever
// worktree is being previewed, one at a time -- and selects this config.

// A junction is the whole point here, and it is also the thing that breaks vite
// if left alone: cwd arrives as the LINK path (…/lane-preview/frontend) while
// module ids resolve to the REAL path (…/fx-provenance/frontend), so every id
// lands outside vite's fs allow-list and every request fails with
// "Failed to load url /src/index.tsx". Resolving the root ourselves makes the
// two agree.
const laneRoot = fs.realpathSync(process.cwd())

// node_modules is itself a junction into the primary checkout, so its real path
// is outside laneRoot and has to be allowed explicitly.
const modulesDir = path.join(laneRoot, 'node_modules')
const realModules = fs.existsSync(modulesDir) ? fs.realpathSync(modulesDir) : modulesDir

// Which Worker this lane's /api, /uploads, /health and /ws proxy to. The base
// config hard-codes 8787, which is the SHARED wrangler port that lanes are
// forbidden to touch, so a lane running its own `wrangler dev --persist-to` on a
// private port needs to retarget it. launch.json has no way to pass an env var
// through, so the port is read from an untracked one-line file in the worktree:
//
//   echo 8811 > frontend/.lane-api-port
//
// Absent or unparseable, it stays on 8787 and the proxy simply refuses to
// connect -- which is the correct, loud failure for a lane that has not started
// its own Worker, rather than silently reading the shared one.
const portFile = path.join(laneRoot, '.lane-api-port')
const configuredPort = fs.existsSync(portFile) ? Number.parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10) : NaN
const apiPort = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65536 ? configuredPort : 8787

export default {
  ...base,
  root: laneRoot,
  // Relative to the root above, i.e. inside the worktree and OUTSIDE the
  // node_modules junction -- which is the point. Every lane worktree's
  // frontend/node_modules is a junction to the primary checkout's, so vite's
  // default cache directory (node_modules/.vite) is SHARED across the whole
  // fleet: running vite from a worktree against it re-optimizes dependencies
  // and swaps that cache out from under every peer's running dev server, which
  // they see as `504 Outdated Optimize Dep` mid-session. Gitignored.
  cacheDir: path.join(laneRoot, '.vite-lane-cache'),
  server: {
    ...base.server,
    // The lane picks the port on the command line (--port). strictPort means a
    // clash fails loudly instead of silently landing on a peer's port and
    // serving them this tree -- the same class of mistake this file exists to
    // prevent.
    strictPort: true,
    fs: { allow: [laneRoot, realModules] },
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      '/uploads': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      '/health': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      '/ws': { target: `ws://localhost:${apiPort}`, changeOrigin: true, ws: true },
    },
  },
} satisfies UserConfig
