# Run and Release Script Reference

Auto-generated script inventory for startup, shutdown, setup, and release workflows.

Total scripts documented: **14**

## setup.bat

- File type: `.bat`
- Total lines: **247**
- Labels: **0**
- Step markers: **0**

## start-server.bat

- File type: `.bat`
- Total lines: **272**
- Labels: **4**
- Step markers: **0**

**Labels**

| Label | Line |
|---|---:|
| `background_start` | 167 |
| `foreground` | 179 |
| `after_start` | 208 |
| `after_health_done` | 225 |

## stop-server.bat

- File type: `.bat`
- Total lines: **113**
- Labels: **1**
- Step markers: **0**

**Labels**

| Label | Line |
|---|---:|
| `kill_loop` | 55 |

## build-release.bat

- File type: `.bat`
- Total lines: **532**
- Labels: **3**
- Step markers: **11**

**Labels**

| Label | Line |
|---|---:|
| `wait_for_frontend_dist` | 175 |
| `frontend_dist_missing` | 182 |
| `frontend_dist_ready` | 194 |

**Step markers**

| Step | Detail | Line |
|---|---|---:|
| STEP 0 | Checking prerequisites... | 55 |
| STEP 0B | Stopping any running packaged server... | 92 |
| STEP 1 | Installing backend dependencies... | 111 |
| STEP 2 | Installing frontend dependencies... | 129 |
| STEP 3 | Building frontend... | 146 |
| STEP 4 | Staging frontend assets for packaging... | 204 |
| STEP 5 | Ensuring @yao-pkg/pkg packager is available... | 223 |
| STEP 6 | Packaging backend to .exe with @yao-pkg/pkg... | 232 |
| STEP 7 | Copying Sharp native binaries... | 277 |
| STEP 8 | Assembling release\business-os folder... | 301 |
| STEP 9 | Building installer... | 463 |

## start-server-release.bat

- File type: `.bat`
- Total lines: **258**
- Labels: **4**
- Step markers: **0**

**Labels**

| Label | Line |
|---|---:|
| `wait_for_proc` | 179 |
| `proc_found` | 195 |
| `health_retry` | 200 |
| `health_done` | 224 |

## stop-server-release.bat

- File type: `.bat`
- Total lines: **124**
- Labels: **0**
- Step markers: **0**

## setup.sh

- File type: `.sh`
- Total lines: **110**

## start-server.sh

- File type: `.sh`
- Total lines: **131**

## stop-server.sh

- File type: `.sh`
- Total lines: **69**

## ops/scripts/frontend/verify-i18n.js

- File type: `.js`
- Total lines: **131**

## ops/scripts/backend/verify-data-integrity.js

- File type: `.js`
- Total lines: **233**

## ops/scripts/generate-doc-reference.js

- File type: `.js`
- Total lines: **465**

## ops/scripts/generate-full-project-docs.js

- File type: `.js`
- Total lines: **633**

## ops/scripts/performance-scan.js

- File type: `.js`
- Total lines: **136**

