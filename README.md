# rms-parity

A Claude Code skill + automated scripts for continuous Figma DS ↔ CSS code parity auditing.

Invoke `/rms-parity` in any project to run a full parity check: Phase 1 refreshes the live Figma snapshot, Phase 2 runs 9 automated gates and a manual component walk. You can never accidentally audit against a stale snapshot.

---

## What it does

| Phase | What happens |
|---|---|
| **1 — Figma Refresh** | Queries live Figma (color, sizing, typography, component structure), diffs against stored snapshots, reports changes, writes updated snapshots, verifies resolvers pass |
| **2 — Code Parity** | Runs all 9 automated gates, component deep-walk, Master Token Table |

**9 automated gates:**

| Gate | Catches |
|---|---|
| [1] Snapshot freshness | Stale snapshot (always ✅ after Phase 1) |
| [2] Token parity | Wrong color/sizing/typography value |
| [3] Structure | Wrong height, padding var, fill structure, stroke presence |
| [4] Bound-token coverage | Token used in Figma but no CSS var in code |
| [5] Unused CSS vars | Declared-but-orphaned vars (Hard Rule #2) |
| [6] Hardcoded values | Raw hex/px in CSS rules (Hard Rule #5) |
| [7] Build freshness | Source newer than built output |
| [8] Sub-component isolation | Parent rule overrides nested sub-component styles (Hard Rule #8) |
| [9] Visual regression | Figma screenshots changed vs stored references (requires `FIGMA_TOKEN`) |

**Everything is read-only.** No source file is ever modified automatically. The only exception is `node scripts/parity-check.mjs --fix`, which must be invoked explicitly and only rewrites sizing/typography literal values.

---

## Example output

```
────────────────────────────────────────────────────────────
  PARITY AUDIT  ·  2026-06-12
────────────────────────────────────────────────────────────

✅  [1] Snapshot freshness
       src/figma-vars.snapshot.json ✓ (updated today)
       src/figma-structure.snapshot.json ✓ (updated today)
       bound-tokens.json ✓ (2h old)

❌  [2] Token parity  (color · sizing · typography)
       ✅ PASS  87   (color + sizing + typography)
       ❌ FAIL  2
         ❌ [color/Dark] buttonPrimary/background → --buttonPrimary-background
              Figma: #ededed   CSS: #d4d4d4
              Fix:  theme.css:42 — --buttonPrimary-background: var(--neutral-200) should resolve to var(--neutral-100) (#ededed)
         ❌ [sizing/-] gap/m → --gap-m
              Figma: 10px   CSS: 8px
              Fix:  theme.css:15 — change --gap-m: 8px → 10px

✅  [3] Structure     (snapshot · CSS height · base-rule vars)
       ✅ PASS 7/7 components

✅  [4] Bound-token coverage  (DS frames → CSS vars)
       ✅ COVERED 43   ❌ UNCOVERED 0

✅  [5] Unused CSS vars
       ✅ 0 unused vars  (3 known-unused exempted)

✅  [6] Hardcoded values  (no raw hex / font-size in rules)
       ✅ Clean

⏭  [7] Build freshness  (source ≤ built output)
       ⏭ No plugins configured in ds-config.json — skipped

✅  [8] Sub-component isolation  (no parent rule overrides sub-component styles)
       ✅ No new undocumented rules

⏭  [9] Visual regression  (frames match stored references)
       ⏭ FIGMA_TOKEN not set — skipped (set env var to enable)

────────────────────────────────────────────────────────────

  AUDIT FAILED — fix all ❌ above before declaring parity

────────────────────────────────────────────────────────────
```

When all gates pass:

```
────────────────────────────────────────────────────────────

  ALL GATES PASS ✅

────────────────────────────────────────────────────────────
```

**Trend view** (`node scripts/audit.mjs --trend`):

```
─── Parity Trend ───────────────────────────────────────────
  ✅  2026-06-10   9/9 [█████████]
  ❌  2026-06-11   7/9 [███████░░]
  ✅  2026-06-12   9/9 [█████████]
────────────────────────────────────────────────────────────
```

---

## Utility flags

```bash
node scripts/audit.mjs --trend           # show last 20 audit runs + trend bar
node scripts/parity-check.mjs --fix      # auto-fix sizing/typography divergences in theme.css
node scripts/setup-webhook.mjs --list    # list registered Figma webhooks for this file
node scripts/setup-webhook.mjs --delete <id>
```

---

## Setup for a new project

### 1. Add as submodule

```bash
git submodule add https://github.com/rafaelmatosds/rms-parity scripts
```

This mounts the scripts at `scripts/` so `node scripts/audit.mjs` works as expected.

### 2. Configure your project

Copy the example files to your project root and fill them in:

```bash
cp scripts/ds-config.example.json ds-config.json
cp scripts/parity-map.example.mjs parity-map.mjs
cp scripts/structure-contract.example.mjs structure-contract.mjs
```

**`ds-config.json`** — paths + Figma identifiers:
```json
{
  "figmaFileKey": "your-figma-file-key",
  "frames": [
    { "name": "My Component Frame", "nodeId": "123-456" }
  ],
  "figma": {
    "colorCollection": "Color",
    "sizingCollection": "Sizing",
    "primitivePrefix": "primitives/",
    "modes": [
      { "name": "Light", "snapshotKey": "light", "cssSelector": "root" },
      { "name": "Dark",  "snapshotKey": "dark",  "cssSelector": "dark-media" }
    ]
  },
  "paths": {
    "themeCSS": "src/theme.css",
    "snapshotVars": "src/figma-vars.snapshot.json",
    "snapshotStructure": "src/figma-structure.snapshot.json",
    "pluginCSS": ["src/ui.src.html"],
    "plugins": []
  },
  "visualRefs": ".parity-refs",
  "knownUnusedVars": [],
  "knownHardcodedExceptions": []
}
```

**`parity-map.mjs`** — token→var mappings, skip lists, primitive scale. Start with the example file and add entries as you run the audit.

**`structure-contract.mjs`** — component structure contracts. Populated from live Figma queries during Phase 1.

### 3. Gitignore the project config

Add to your project's `.gitignore`:
```
ds-config.json
parity-map.mjs
structure-contract.mjs
bound-tokens.json
```

`parity-history.json` and `.parity-refs/` should be **committed** — they're your audit trail and visual baseline.

### 4. Set up the global skill

```bash
mkdir -p ~/.claude/commands
ln -sf ~/path/to/rms-parity/.claude/commands/rms-parity.md ~/.claude/commands/rms-parity.md
```

Now `/rms-parity` is available in every project.

---

## Webhook automation (optional)

Automatically trigger parity checks when Figma publishes a library update:

```bash
# Start the server (keep running, e.g. via pm2)
node scripts/webhook-server.mjs

# Register with Figma once (requires a public URL)
FIGMA_TOKEN=xxx node scripts/setup-webhook.mjs --url https://your-host.com/webhook
```

Configure `webhook.port` and `webhook.secret` in `ds-config.json`. The server never modifies source files — it only reports.

---

## Visual regression (optional)

Gate [9] compares live Figma frame screenshots against stored references:

```bash
export FIGMA_TOKEN=xxx
node scripts/audit.mjs   # Gate [9] runs automatically
```

First run saves references to `.parity-refs/`. Subsequent runs diff against them. To accept a change:

```bash
mv .parity-refs/<frame-id>.new.png .parity-refs/<frame-id>.png
```

---

## Usage

In any project with `scripts/` mounted and `ds-config.json` at root:

```
/rms-parity
```

---

## Keeping projects in sync

When you improve the workflow on one project, commit and push. All other projects get the update via:

```bash
git submodule update --remote scripts
```

Project-specific data (`ds-config.json`, `parity-map.mjs`, `structure-contract.mjs`) never leaves the project.

---

## Hard Rules

1. Every Figma component token → dedicated CSS variable
2. Every CSS variable → at least one rule consumer (no orphans)
3. Naming convention exact (see skill for full spec)
4. All configured modes must match
5. No hardcoded hex/px in CSS rules (declarations OK)
6. New Figma tokens detected → implemented before audit closes
7. Hidden Figma nodes (visible=false) → never implemented in code
8. DS sub-components nested inside parent components → always retain their own styles
