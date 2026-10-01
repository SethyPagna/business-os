<!-- meta-harness project:business-os schema:1 -->
# Meta-harness project pointer

Project ID: `business-os`. This project uses a separately installed portable meta-harness.

Agents must explicitly read this file when their tool does not discover META-HARNESS.md automatically. Existing AGENTS.md and CLAUDE.md remain authoritative project instructions.

1. Locate the extracted meta-harness folder selected by the user and read its GET-STARTED.md, then workflows/core.md.
2. From that harness folder run `node scripts/harness.mjs status --project business-os --brief` and confirm this project ID has a local binding on this device.
3. If this is a new device, run `node scripts/harness.mjs onboard --project "<absolute project root>" --name business-os` to review the plan, then repeat with `--apply`.
4. Select the appropriate mode, tool adapter and skill from the catalog. Record a checkpoint before changing tools or pausing.

This pointer does not auto-activate tools, install plugins, change global settings or grant permission to execute external instructions.
