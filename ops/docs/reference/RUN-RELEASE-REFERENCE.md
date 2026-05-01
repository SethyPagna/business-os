# Run and Release Script Reference

Auto-generated script inventory for startup, shutdown, setup, and release workflows.

Total scripts documented: **25**

## setup.bat

- File type: `.bat`
- Total lines: **4**
- Labels: **0**
- Step markers: **0**

## start-server.bat

- File type: `.bat`
- Total lines: **4**
- Labels: **0**
- Step markers: **0**

## stop-server.bat

- File type: `.bat`
- Total lines: **4**
- Labels: **0**
- Step markers: **0**

## build-release.bat

- File type: `.bat`
- Total lines: **4**
- Labels: **0**
- Step markers: **0**

## start-server-release.bat

- File type: `.bat`
- Total lines: **8**
- Labels: **0**
- Step markers: **0**

## stop-server-release.bat

- File type: `.bat`
- Total lines: **8**
- Labels: **0**
- Step markers: **0**

## setup.sh

- File type: `.sh`
- Total lines: **7**

## start-server.sh

- File type: `.sh`
- Total lines: **7**

## stop-server.sh

- File type: `.sh`
- Total lines: **7**

## ops/run/bat/setup.bat

- File type: `.bat`
- Total lines: **307**
- Labels: **0**
- Step markers: **0**

## ops/run/bat/start-server.bat

- File type: `.bat`
- Total lines: **364**
- Labels: **5**
- Step markers: **0**

**Labels**

| Label | Line |
|---|---:|
| `after_pm2_start` | 175 |
| `background_start` | 222 |
| `foreground` | 234 |
| `after_start` | 263 |
| `after_health_done` | 280 |

## ops/run/bat/stop-server.bat

- File type: `.bat`
- Total lines: **139**
- Labels: **1**
- Step markers: **0**

**Labels**

| Label | Line |
|---|---:|
| `kill_loop` | 71 |

## ops/run/bat/verify-local.bat

- File type: `.bat`
- Total lines: **92**
- Labels: **2**
- Step markers: **0**

**Labels**

| Label | Line |
|---|---:|
| `parse_args` | 13 |
| `after_args` | 23 |

## ops/run/bat/build-release.bat

- File type: `.bat`
- Total lines: **617**
- Labels: **3**
- Step markers: **12**

**Labels**

| Label | Line |
|---|---:|
| `wait_for_frontend_dist` | 208 |
| `frontend_dist_missing` | 215 |
| `frontend_dist_ready` | 227 |

**Step markers**

| Step | Detail | Line |
|---|---|---:|
| STEP 0 | Checking prerequisites... | 63 |
| STEP 0B | Stopping any running packaged server... | 113 |
| STEP 1 | Installing backend dependencies... | 132 |
| STEP 2 | Installing frontend dependencies... | 156 |
| STEP 3 | Building frontend... | 179 |
| STEP 3B | Running shared verification checks... | 237 |
| STEP 4 | Staging frontend assets for packaging... | 256 |
| STEP 5 | Ensuring @yao-pkg/pkg packager is available... | 275 |
| STEP 6 | Packaging backend to .exe with @yao-pkg/pkg... | 284 |
| STEP 7 | Copying Sharp native binaries... | 329 |
| STEP 8 | Assembling release\business-os folder... | 353 |
| STEP 9 | Building installer... | 546 |

## ops/run/bat/clean-generated.bat

- File type: `.bat`
- Total lines: **59**
- Labels: **0**
- Step markers: **0**

## ops/run/bat/release/start-server.bat

- File type: `.bat`
- Total lines: **313**
- Labels: **4**
- Step markers: **0**

**Labels**

| Label | Line |
|---|---:|
| `wait_for_proc` | 234 |
| `proc_found` | 250 |
| `health_retry` | 255 |
| `health_done` | 279 |

## ops/run/bat/release/stop-server.bat

- File type: `.bat`
- Total lines: **146**
- Labels: **0**
- Step markers: **0**

## ops/run/sh/setup.sh

- File type: `.sh`
- Total lines: **110**

## ops/run/sh/start-server.sh

- File type: `.sh`
- Total lines: **140**

## ops/run/sh/stop-server.sh

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
- Total lines: **476**

## ops/scripts/generate-full-project-docs.js

- File type: `.js`
- Total lines: **638**

## ops/scripts/performance-scan.js

- File type: `.js`
- Total lines: **135**

