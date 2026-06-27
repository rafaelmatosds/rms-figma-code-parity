# rms-figma-code-parity

A Claude Code skill + automated scripts for continuous Figma DS ↔ CSS code parity auditing.

Invoke `/rms-figma-code-parity` in any project to run a full parity check: Phase 1 refreshes the live Figma snapshot, Phase 2 runs 12 automated gates. You can never accidentally audit against a stale snapshot.

> **Sister skill:** [rms-figma-sync](https://github.com/rafaelmatosds/rms-figma-sync) — checks whether a consumer Figma product file is in sync with the DS library. Use that for design handoff validation; use this one for code implementation validation.

---

## Quick start

**1 — Install the skill (once per machine)**

```bash
curl -fsSL https://raw.githubusercontent.com/rafaelmatosds/rms-figma-code-parity/main/install.sh | bash
```

This copies `rms-figma-code-parity.md` to `~/.claude/commands/` so `/rms-figma-code-parity` is available in every project.

**2 — Add to a project (once per repo)**

```bash
git submodule add https://github.com/rafaelmatosds/rms-figma-code-parity scripts
node scripts/audit.mjs --init
```

`--init` asks 4 questions, auto-detects everything else, and prints a checklist of what to fill in next.

**3 — Run**

Open Claude Code inside the project and run:

```
/rms-figma-code-parity
```

---

## What it does

| Phase | What happens |
|---|---|
| **1 — Figma Refresh** | Queries live Figma (color, sizing, typography, component structure), diffs against stored snapshots, reports changes, writes updated snapshots, verifies resolvers pass |
| **2 — Code Parity** | Runs all 12 automated gates, component deep-walk, HTML parity report |

**12 automated gates:**

| Gate | Script | What it checks |
|---|---|---|
| [1]  | inline | **Freshness** — Snapshot files pulled today and compiled plugin outputs not older than their sources. Combines snapshot-staleness and build-staleness into one signal. |
| [2]  | `parity-check.mjs` | **Token parity** — Every design token value (color, size, typography, all modes) matches Figma. Flags value mismatches, missing variables, and wrong alias chains. |
| [3]  | `structure-check.mjs` | **Structure** — Each component's height, spacing, font, and radius are wired to the right design tokens — not hardcoded, not missing. |
| [4]  | `bound-check.mjs` | **Bound-token coverage** — Every token actively used in the Figma frames has a matching CSS variable in the codebase. |
| [5]  | inline | **CSS hygiene** — No declared-but-orphaned CSS variables (unused weight) and no raw literal values in CSS rules (hardcoded hex, px, etc.). |
| [6]  | `subcomponent-isolation-check.mjs` | **Sub-component isolation** — Parent component styles don't bleed into nested DS sub-components. |
| [7]  | `visual-regression-check.mjs` | **Visual regression** — Live Figma frame screenshot matches the stored reference. Flags any visual drift. Skips if no Figma token is configured. |
| [8]  | `state-check.mjs` `state-binding-check.mjs` `component-selector-check.mjs` | **State coverage** — Three checks in one: all Figma component states have tokens (`state-check`), every `CONTRACT.propertyMap` state selector exists in CSS (`state-binding-check`), and state-suffix vars only appear inside matching state selectors (`component-selector-check`). |
| [9]  | `exemption-check.mjs` | **Exemption validity** — Tokens marked as "skip this" are cross-checked against the snapshot. Stale exemptions are flagged. |
| [10] | `mode-completeness-check.mjs` | **Mode completeness** — Every token that varies between modes actually adapts — nothing frozen at the same value across modes that are supposed to differ. |
| [11] | `naming-check.mjs` | **CSS naming round-trip** — Every CSS variable name traces back to a real Figma token. Catches invented variables with no DS counterpart. |
| [12] | `pseudo-element-check.mjs` `icon-check.mjs` | **Contract coverage** — `::before`/`::after` elements and SVG `<symbol>` elements must be declared in the structure contract. DS icons must record a Figma node ID; custom icons must be marked `PLUGIN-SPECIFIC`. |

**Everything is read-only.** No source file is ever modified automatically. The only exception is `node scripts/parity-check.mjs --fix`, which must be invoked explicitly and only rewrites sizing/typography literal values.

---

## Example output

```
────────────────────────────────────────────────────────────
  PARITY AUDIT  ·  2026-06-17
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

────────────────────────────────────────────────────────────

  AUDIT FAILED — fix all ❌ above before declaring parity

────────────────────────────────────────────────────────────
```

**Trend view** (`node scripts/audit.mjs --trend`):

```
─── Parity Trend ───────────────────────────────────────────
  ✅  2026-06-15  12/12 [████████████]
  ❌  2026-06-16  11/13 [███████████░]
  ✅  2026-06-17  12/12 [████████████]
────────────────────────────────────────────────────────────
```

---

## Utility flags

```bash
node scripts/audit.mjs --init                        # first-time setup only: scaffold config files, then exit
node scripts/audit.mjs --trend                       # show last 20 audit runs + trend bar
node scripts/audit.mjs --report-html parity.html     # generate HTML report (gate cards + token table)
node scripts/parity-check.mjs --fix                  # auto-fix sizing/typography divergences in theme.css
node scripts/setup-webhook.mjs --list                # list registered Figma webhooks for this file
node scripts/setup-webhook.mjs --delete <id>
```

---

## Setup for a new project

### 1. Add as submodule

```bash
git submodule add https://github.com/rafaelmatosds/rms-figma-code-parity scripts
```

This mounts the scripts at `scripts/` so `node scripts/audit.mjs` works as expected.

### 2. Run --init (or just run the audit)

```bash
node scripts/audit.mjs --init
```

This asks 4 questions, then auto-detects everything else:

1. **Main Design System Figma file** — paste the browser URL; file key is parsed automatically
2. **Token CSS path** — auto-detected if exactly one file found; confirm or override
3. **Figma personal access token** *(optional)* — used to query Figma collections automatically and for Gate [9] visual regression; saved to `.env`
4. **Upstream DS source for cross-checking** *(optional)* — if the snapshot file is from a downstream fork, provide the upstream DS URL. Enables `⏳ PENDING FIGMA SYNC` in Gate [2] so that mismatches where code matches the upstream source are flagged as pending rather than failures.

What gets created automatically:
- `ds-config.json` — with Figma collection names detected via API (no manual lookup needed)
- `parity-map.mjs` — scaffolded from example with commented instructions
- `structure-contract.mjs` — scaffolded from example with commented instructions
- `.env` — FIGMA_TOKEN written if provided
- `.gitignore` entries added for all of the above

Then fill in what the checklist tells you (frame node IDs, primitive scale, component contracts) and run `/rms-figma-code-parity` Phase 1.

### 3. Set up the skill

```bash
mkdir -p ~/.claude/commands
cp rms-figma-code-parity.md ~/.claude/commands/
```

Now `/rms-figma-code-parity` is available in every project.

---

## Upstream source cross-check

When your snapshot file is taken from a downstream or branded fork of an upstream DS, set `figmaSourceKey` in `ds-config.json` to the upstream DS file key. Phase 1 queries both files. Any token where CSS matches the upstream source but not the primary snapshot is classified as `⏳ PENDING FIGMA SYNC` instead of `❌ FAIL` — it's not a code bug, it's a pending snapshot update.

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

## Visual regression

Gate [9] compares live Figma frame screenshots against stored references.

Requires `FIGMA_TOKEN` in `.env` and at least one entry in `ds-config.json → frames`. Skips silently if either is absent.

Get a token: Figma → Account Settings → Personal access tokens → Generate (File content: read scope).

To accept a visual change as the new baseline:

```bash
mv .parity-refs/<frame-id>.new.png .parity-refs/<frame-id>.png
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
7. Hidden node WITH a boolean visibility variable → implement its tokens. Hidden node with NO boolean variable → flag, never implement
8. DS sub-components nested inside parent components → always retain their own styles
9. CSS alias chains must mirror Figma exactly — same primitive, same order
