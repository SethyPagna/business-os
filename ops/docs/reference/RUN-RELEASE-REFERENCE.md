# Run and Release Script Reference

Auto-generated script inventory for startup, shutdown, setup, and release workflows.

Total scripts documented: **17**

## Start Business OS.bat

- File type: `.bat`
- Total lines: **43**
- Labels: **0**
- Step markers: **0**

## run/setup.bat

- File type: `.bat`
- Total lines: **378**
- Labels: **0**
- Step markers: **0**

## run/start-server.bat

- File type: `.bat`
- Total lines: **571**
- Labels: **6**
- Step markers: **0**

**Labels**

| Label | Line |
|---|---:|
| `after_pm2_start` | 247 |
| `after_remote_access_provider` | 392 |
| `background_start` | 402 |
| `foreground` | 414 |
| `after_start` | 443 |
| `after_health_done` | 460 |

## run/stop-server.bat

- File type: `.bat`
- Total lines: **183**
- Labels: **1**
- Step markers: **0**

**Labels**

| Label | Line |
|---|---:|
| `kill_loop` | 101 |

## run/verify-local.bat

- File type: `.bat`
- Total lines: **130**
- Labels: **2**
- Step markers: **0**

**Labels**

| Label | Line |
|---|---:|
| `parse_args` | 13 |
| `after_args` | 23 |

## run/build-release.bat

- File type: `.bat`
- Total lines: **634**
- Labels: **3**
- Step markers: **12**

**Labels**

| Label | Line |
|---|---:|
| `wait_for_frontend_dist` | 204 |
| `frontend_dist_missing` | 211 |
| `frontend_dist_ready` | 223 |

**Step markers**

| Step | Detail | Line |
|---|---|---:|
| STEP 0 | Checking prerequisites... | 63 |
| STEP 0B | Stopping any running packaged server... | 113 |
| STEP 1 | Installing backend dependencies... | 128 |
| STEP 2 | Installing frontend dependencies... | 152 |
| STEP 3 | Building frontend... | 175 |
| STEP 3B | Running shared verification checks... | 233 |
| STEP 4 | Staging frontend assets for packaging... | 252 |
| STEP 5 | Ensuring @yao-pkg/pkg packager is available... | 271 |
| STEP 6 | Packaging backend to .exe with @yao-pkg/pkg... | 280 |
| STEP 7 | Copying Sharp native binaries... | 325 |
| STEP 8 | Assembling release\business-os folder... | 349 |
| STEP 9 | Building installer... | 562 |

## run/clean-generated.bat

- File type: `.bat`
- Total lines: **60**
- Labels: **0**
- Step markers: **0**

## run/release/start-server.bat

- File type: `.bat`
- Total lines: **151**
- Labels: **1**
- Step markers: **0**

**Labels**

| Label | Line |
|---|---:|
| `health_done` | 135 |

## run/release/stop-server.bat

- File type: `.bat`
- Total lines: **55**
- Labels: **0**
- Step markers: **0**

## run/sh/setup.sh

- File type: `.sh`
- Total lines: **122**

## run/sh/start-server.sh

- File type: `.sh`
- Total lines: **153**

## run/sh/stop-server.sh

- File type: `.sh`
- Total lines: **62**

## ops/scripts/frontend/verify-i18n.js

- File type: `.js`
- Total lines: **145**

## ops/scripts/backend/verify-data-integrity.js

- File type: `.js`
- Total lines: **233**

## ops/scripts/generate-doc-reference.js

- File type: `.js`
- Total lines: **474**

## ops/scripts/generate-full-project-docs.js

- File type: `.js`
- Total lines: **638**

## ops/scripts/performance-scan.js

- File type: `.js`
- Total lines: **135**

