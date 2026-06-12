# rms-parity

A Claude Code skill + automated scripts for continuous Figma DS ↔ CSS code parity auditing.

Invoke `/rms-parity` in any project to run a full parity check: Phase 1 refreshes the live Figma snapshot, Phase 2 runs 8 automated gates and a manual component walk. You can never accidentally audit against a stale snapshot.

---

## What it does

| Phase | What happens |
|---|---|
| **1 — Figma Refresh** | Queries live Figma (color, sizing, typography, component structure), diffs against stored snapshots, reports changes, writes updated snapshots, verifies resolvers pass |
| **2 — Code Parity** | Runs all 8 automated gates, component deep-walk, screenshots, Master Token Table |

**8 automated gates:**

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

---

## Setup for a new project

### 1. Add as submodule

```bash
git submodule add https://github.com/YOUR_USERNAME/rms-parity scripts
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
    { "name": "My Plugin", "nodeId": "123-456" }
  ],
  "paths": {
    "themeCSS": "src/theme.css",
    "snapshotVars": "src/figma-vars.snapshot.json",
    "snapshotStructure": "src/figma-structure.snapshot.json",
    "pluginCSS": ["src/ui.src.html"],
    "plugins": []
  },
  "knownUnusedVars": [],
  "knownFontSizeExceptions": []
}
```

**`parity-map.mjs`** — token→var mappings, skip lists, covered tokens. Start with the example file and add entries as you run the audit.

**`structure-contract.mjs`** — component structure contracts. Populated from live Figma queries during Phase 1.

### 3. Gitignore the project config

Add to your project's `.gitignore`:
```
ds-config.json
parity-map.mjs
structure-contract.mjs
bound-tokens.json
```

### 4. Set up the global skill

```bash
ln -s ~/path/to/rms-parity/.claude/commands/rms-parity.md ~/.claude/commands/rms-parity.md
```

Now `/rms-parity` is available in every project.

---

## Usage

In any project that has `scripts/` mounted (submodule or copy) and `ds-config.json` at root:

```
/rms-parity
```

---

## Keeping projects in sync

When you improve the workflow on one project (new gate, better Figma query, new Hard Rule), commit to this repo and push. All other projects get the improvement via:

```bash
git submodule update --remote scripts
```

Project-specific data (`ds-config.json`, `parity-map.mjs`, `structure-contract.mjs`) never leaves the project — it's gitignored.

---

## Updating your existing project to use this repo

If your project already has `scripts/` with manual copies of these files:

```bash
# Remove existing scripts
rm -rf scripts/

# Add submodule
git submodule add https://github.com/YOUR_USERNAME/rms-parity scripts

# Create your config files from examples
cp scripts/ds-config.example.json ds-config.json
cp scripts/parity-map.example.mjs parity-map.mjs
cp scripts/structure-contract.example.mjs structure-contract.mjs
# Fill in your existing token mappings and contracts
```

---

## Hard Rules

1. Every Figma component token → dedicated CSS variable
2. Every CSS variable → at least one rule consumer (no orphans)
3. Naming convention exact (see skill for full spec)
4. Both light and dark modes must match
5. No hardcoded hex/px in CSS rules (declarations OK)
6. New Figma tokens detected → implemented before audit closes
7. Hidden Figma nodes (visible=false) → never implemented in code
8. DS sub-components nested inside parent components → always retain their own styles
