# Run and Release Script Reference

Auto-generated script inventory for startup, shutdown, setup, and release workflows.

Total scripts documented: **14**

## setup.bat

- File type: `.bat`
- Total lines: **280**
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
- Total lines: **578**
- Labels: **3**
- Step markers: **12**

**Labels**

| Label | Line |
|---|---:|
| `wait_for_frontend_dist` | 187 |
| `frontend_dist_missing` | 194 |
| `frontend_dist_ready` | 206 |

**Step markers**

| Step | Detail | Line |
|---|---|---:|
| STEP 0 | Checking prerequisites... | 55 |
| STEP 0B | Stopping any running packaged server... | 92 |
| STEP 1 | Installing backend dependencies... | 111 |
| STEP 2 | Installing frontend dependencies... | 135 |
| STEP 3 | Building frontend... | 158 |
| STEP 3B | Running verification checks... | 216 |
| STEP 4 | Staging frontend assets for packaging... | 250 |
| STEP 5 | Ensuring @yao-pkg/pkg packager is available... | 269 |
| STEP 6 | Packaging backend to .exe with @yao-pkg/pkg... | 278 |
| STEP 7 | Copying Sharp native binaries... | 323 |
| STEP 8 | Assembling release\business-os folder... | 347 |
| STEP 9 | Building installer... | 509 |

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
- Total lines: **637**

## ops/scripts/performance-scan.js

- File type: `.js`
- Total lines: **136**

