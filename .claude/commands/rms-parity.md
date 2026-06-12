# /rms-parity — Figma DS ↔ Code Parity

Full parity workflow in one command. Phase 1 (live Figma refresh) always runs before Phase 2 (code audit) — you can never accidentally audit against a stale snapshot.

## Usage

```
/rms-parity
```

---

## Project Config

At the start of every run, read `./ds-config.json` from the project root. If it doesn't exist, stop and tell the user to copy `ds-config.example.json` → `ds-config.json` and fill in their values.

Extract:
- `figmaFileKey` — Figma file key
- `frames` — array of `{ name, nodeId }` — the DS frame(s) to audit

Use these throughout Phase 1 (Figma queries) and Phase 2 (screenshots).

---

## Key Architecture Assumptions

- CSS mapping: **Light** → `:root { }`, **Dark** → `@media (prefers-color-scheme: dark) { :root { } }`
- Token naming convention: `token/path/default` → `--token-path` (drop `/default`, `/color`; `/iconText/` → `/text/`; `/` → `-`)
- Neutral primitive scale: `N100–N1000` — inverted between light and dark (dark gets lighter values)
- Snapshot files at paths defined in `ds-config.json`

---

## Hard Rules

1. **Every Figma component token must have a dedicated CSS variable.** No token may be covered only by an inline value. `via` is acceptable only when a semantic alias is documented in `parity-map.mjs`.
2. **Every CSS variable must be wired into at least one CSS rule.** A declared-but-unused var must be deleted. Variables are declared when the component exists in code, not before.
3. **Naming convention must be followed exactly.** A correct value under a wrong name is still a divergence.
4. **Both modes must match.** A token correct in dark but wrong in light is still a divergence.
5. **Hardcoded values in CSS rules are always flagged.** Colors → `var(--)`, font-sizes → scale vars, borders → `var(--thickness)`, radii → `var(--radius-*)`. Raw px/hex in a rule (not a `:root` declaration) is a divergence.
6. **New Figma component tokens detected during any audit step must be implemented in code before the audit closes.**
7. **Hidden elements (visible=false) in Figma are flagged but never implemented in code.** A token bound only to a hidden layer is `⚠️ HIDDEN — not implemented`. Never add a CSS var for a token whose only binding is on a hidden node.
8. **Every DS sub-component nested inside another DS component must retain its own CSS styles.** A parent component's rule that combines a component class with a bare element tag (`.node svg { color: X }`) directly targets that element — direct targeting beats inheritance. When adding any CSS rule of the form `.<componentClass> <elementTag> { <visual-property> }`, either (a) prove it's a leaf component, or (b) add explicit `.<subComponent> <elementTag> { }` overrides later in the cascade. Add every such rule to the `ALLOWED` map in `subcomponent-isolation-check.mjs`. Gate [8] enforces this mechanically.

---

## Snapshot Files

| File | Contents | Path (from ds-config.json) |
|---|---|---|
| `figma-vars.snapshot.json` | color (both modes), sizing, typography | `paths.snapshotVars` |
| `figma-structure.snapshot.json` | per-component State=Default structure | `paths.snapshotStructure` |

Both are machine-generated — never hand-edit. `bound-tokens.json` (project root, gitignored) is a transient capture of Phase 2 Step 1b.

---

## How to Execute

| Phase | Step | Purpose | Must pass |
|---|---|---|---|
| **1** | **Figma Refresh** | **Query live Figma, diff snapshots, overwrite both files, verify resolvers** | **Snapshots fresh; every change reconciled** |
| **2** | **Bound token walk** | **Walk all DS frames → save to `bound-tokens.json`** | **File written** |
| **2** | **`node scripts/audit.mjs`** | **All 8 gates — Gate [1] always ✅ since Phase 1 just ran** | **0 ❌ gates** |
| 2 | Component walk | Deep per-component inspection of all states, vars, tokens | 0 new divergences |
| 2 | Screenshots | Visual regression against all DS frames | No visible regressions |
| 2 | Master Token Table | Single source of truth with resolved hex for every token | 0 ❌ rows |

---

# PHASE 1 — Figma Refresh

---

## Phase 1 — Step 1: Query live Figma values

```js
function toHex(c) {
  return '#' + [c.r,c.g,c.b].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
}
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const idToVar = {};
for (const col of collections) {
  for (const id of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id); if (v) idToVar[id] = v;
  }
}
function resolveInMode(varId, modeId, depth=0) {
  if (depth > 10) return { hex: null };
  const v = idToVar[varId]; if (!v) return { hex: null };
  const val = v.valuesByMode[modeId] ?? Object.values(v.valuesByMode)[0];
  if (!val) return { hex: null };
  if (typeof val === 'object' && val.type === 'VARIABLE_ALIAS') return resolveInMode(val.id, modeId, depth + 1);
  if (typeof val === 'object' && 'r' in val) return { hex: toHex(val) };
  return { hex: String(val) };
}
const col = collections.find(c => c.name === 'Color');
const darkId  = col.modes.find(m => m.name === 'Dark').modeId;
const lightId = col.modes.find(m => m.name === 'Light').modeId;
const colorOut = { dark: {}, light: {} };
for (const id of col.variableIds) {
  const v = idToVar[id];
  if (!v || v.resolvedType !== 'COLOR' || v.name.startsWith('primitives/')) continue;
  colorOut.dark[v.name]  = resolveInMode(id, darkId).hex;
  colorOut.light[v.name] = resolveInMode(id, lightId).hex;
}
const sizingCol = collections.find(c => c.name === 'Sizing');
const sizingOut = {};
if (sizingCol) {
  const modeId = sizingCol.modes[0].modeId;
  for (const id of sizingCol.variableIds) {
    const v = idToVar[id]; if (!v) continue;
    const val = v.valuesByMode[modeId] ?? Object.values(v.valuesByMode)[0];
    sizingOut[v.name] = typeof val === 'number' ? val + 'px' : String(val);
  }
}
const WEIGHT = {'Thin':100,'Extra Light':200,'Light':300,'Regular':400,'Medium':500,'Semi Bold':600,'Bold':700,'Extra Bold':800,'Black':900};
const styles = await figma.getLocalTextStylesAsync();
const typo = {};
for (const st of styles) {
  const key = st.name.trim().toLowerCase().split('/').pop();
  if (!['m','s','l'].includes(key)) continue;
  const entry = { size: Math.round(st.fontSize * 10) / 10 + 'px' };
  const w = WEIGHT[st.fontName.style]; if (w) entry.weight = String(w);
  if (st.lineHeight?.unit === 'PIXELS') entry.lh = Math.round(st.lineHeight.value * 10) / 10 + 'px';
  typo[key] = entry;
}
return { color: colorOut, sizing: sizingOut, typography: typo };
```

> Adapt `col.name === 'Color'`, `'Sizing'`, and the `Dark`/`Light` mode names to match your Figma file's collection names.

---

## Phase 1 — Step 1c: Capture component structure → `figma-structure.snapshot.json`

Navigate to your DS Components page, find each `COMPONENT_SET`, navigate to the `State=Default` child, and extract structural facts:

```js
// Always query State=Default CHILD, never the SET node (SET height = all variants stacked).
// Extract: h, paddingVar {tb,lr}, gapVar, fontSizeVar, fontWeightVar,
//          fillStructure ('direct' | 'before' | 'none'), innerRadiusVar, strokeOnDefault
// fillStructure = 'before' when fill is on a child "Background" rect (→ CSS ::before)
//                 'direct' when on the frame itself
//                 'none' when default state has no fill
```

Write the result in this shape:
```json
{
  "_updated": "YYYY-MM-DD",
  "_note": "Auto-generated by /rms-parity. Do not edit manually.",
  "components": {
    "button": { "h": 32, "paddingVar": { "tb": "padding/s", "lr": "padding/m" }, ... }
  }
}
```

---

## Phase 1 — Step 2: Read the snapshots

Read both snapshot files. Parse them. If either is missing, treat all live values as new and skip to Step 4.

---

## Phase 1 — Step 3: Diff

Compare live vs snapshot across all sections: `color` (both modes), `sizing`, `typography`, `structure`.

**Changed tokens** → ⚠️ value changed
**New tokens** → 🆕 new — needs CSS var (Hard Rule #1)
**Removed tokens** → 🗑 deleted — check if CSS var can be removed

If diff is empty: print `✅ No DS changes since last snapshot (YYYY-MM-DD).`

---

## Phase 1 — Step 4: Impact analysis

For every changed or new token, check whether a corresponding CSS var exists:
- ✅ CSS var exists and already correct — no action
- ⚠️ CSS var exists but value wrong — list it
- ❌ No CSS var — must add one (Hard Rule #1)

**Blocking:** reconcile all changes in CSS before running Phase 2.

---

## Phase 1 — Step 5: Update snapshots

Write fresh live data to both files. Update `_updated` to today's date. Only overwrite `typography` if the text-style capture returned real values.

---

## Phase 1 — Step 6: Verify resolvers

```bash
node scripts/parity-check.mjs
node scripts/structure-check.mjs
```

If either reports FAIL/NEW SKIP, reconcile CSS before Phase 2.

---

## Phase 1 — Step 7: Summary

Print tokens changed/added/removed per section, which CSS vars need updating, confirmation both snapshots refreshed and resolvers pass.

---

# PHASE 2 — Code Parity

---

## Phase 2 — Step 1b: Bound token walk → `bound-tokens.json`

Walk all DS frames and capture every token bound to at least one **visible** node. Skip `visible=false` nodes (Hard Rule #7). Save to `bound-tokens.json` at project root.

```js
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const idToVar = {};
for (const col of collections) {
  for (const id of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id); if (v) idToVar[id] = v;
  }
}
// Replace frameIds with the nodeIds from ds-config.json
const frameIds = ['YOUR_FRAME_NODE_ID_1', 'YOUR_FRAME_NODE_ID_2'];
const used = {};
const hidden = {};
for (const fid of frameIds) {
  const frame = figma.currentPage.findOne(n => n.id === fid); if (!frame) continue;
  function walk(node, ancestorHidden = false) {
    const isHidden = ancestorHidden || node.visible === false;
    if (node.boundVariables) {
      for (const [prop, binding] of Object.entries(node.boundVariables)) {
        const bindings = Array.isArray(binding) ? binding : [binding];
        for (const b of bindings) {
          if (!b?.id) continue;
          const v = idToVar[b.id];
          if (!v || v.name.startsWith('primitives/')) continue;
          if (isHidden) {
            if (!hidden[v.name]) hidden[v.name] = [];
            hidden[v.name].push({ frame: fid, nodeId: node.id, nodeName: node.name, prop, reason: 'visible=false' });
          } else {
            if (!used[v.name]) used[v.name] = [];
            used[v.name].push({ frame: fid, nodeId: node.id, nodeName: node.name, prop });
          }
        }
      }
    }
    if ('children' in node) node.children.forEach(c => walk(c, isHidden));
  }
  walk(frame);
}
if (Object.keys(hidden).length) console.log('⚠️ HIDDEN tokens (not implemented per Hard Rule #7):', Object.keys(hidden));
return used;
```

**Save output to `bound-tokens.json` at project root.**

---

## Phase 2 — Step 2: Run all 8 audit gates

```bash
node scripts/audit.mjs
```

All 8 gates must pass. Gate [1] is always ✅ since Phase 1 just ran.

| Gate | What it catches |
|---|---|
| [1] | Snapshot freshness — always ✅ after Phase 1 |
| [2] | Token value parity — color + sizing + typography |
| [3] | Structural parity — height, padding/gap vars, fill structure, stroke |
| [4] | Bound-token coverage — token used in Figma but no CSS var |
| [5] | Unused CSS vars (Hard Rule #2) |
| [6] | Hardcoded values in CSS rules (Hard Rule #5) |
| [7] | Build freshness — source newer than built output |
| [8] | Sub-component isolation (Hard Rule #8) |

---

## Phase 2 — Step 3: Component deep-walk

For every DS component, walk all states and extract fill/stroke/padding/gap/radius/text with bound variable names:

```js
const page = figma.root.children.find(p => p.name === 'Components'); // adjust to your page name
await figma.setCurrentPageAsync(page);
// ... use describe() pattern to extract per-state structural data ...
```

Compare against `structure-contract.mjs` entries. Any drift → update contract AND CSS together.

**Stroke presence rule:** if `strokes: []` on the Default state → CSS must use `border: var(--thickness) solid transparent`. Never use a token color on the default state.

---

## Phase 2 — Step 4: Hardcoded value scan (A–F)

Run across all production CSS files (theme CSS + all plugin/component CSS):

**A.** Hex colors in rules (not `:root` declarations)
**B.** Hardcoded font sizes (use scale vars)
**C.** Hardcoded border radius (use `var(--radius-*)`)
**D.** Hardcoded border widths (use `var(--thickness)`)
**E.** Hardcoded spacing (use `var(--gap-*)` / `var(--padding-*)`)
**F.** JS inline styles (`element.style.color = ...`)

Document intentional exceptions in `ds-config.json → knownFontSizeExceptions` and as comments.

---

## Phase 2 — Step 5: State coverage check

For every DS component with multiple states, verify a corresponding CSS rule exists.

---

## Phase 2 — Step 6: Dark override completeness

Every token where Light ≠ Dark must have an explicit dark override OR use a self-adapting neutral var. Gate [2] catches this automatically.

---

## Phase 2 — Step 7: Screenshots

Use `get_screenshot` with your frame IDs from `ds-config.json`. Compare against prior screenshots. Flag any visible difference not already surfaced by the automated gates.

---

## Phase 2 — Step 8: Build freshness

If your project has a build step:

```bash
# rebuild, then check for uncommitted changes in built output
git status --short -- '<built output paths>'
```

Expected: empty output. Any listed file = stale build.

---

## Phase 2 — Step 9: Master Token Table

Produce one table covering every Figma component token:

| Figma token | CSS var | Name | L Figma | L Code | L | D Figma | D Code | D | Alias |
|---|---|---|---|---|---|---|---|---|---|

- `none` = token exists in Figma, no CSS var yet
- `via --alias` = covered by a semantic alias
- `~` = Figma value null/missing
- **L Code / D Code must show the actual resolved hex**, not just the var reference

After the table: Divergence summary (❌ rows), Unused vars, New Figma tokens.

---

## Naming Convention

| Rule | Example |
|---|---|
| Preserve camelCase | `buttonTertiary`, `segmentedControl` |
| `/background/` → `-background` | never `-bg` |
| `/iconText/` → `-text` | only allowed shortening |
| `/default/` → omit | base token has no state suffix |
| `/color` → always omit | |
| State names verbatim | `active`, `selected`, `hover`, `disabled`, `current` |
| Sizing: last segment | `gap/m` → `--gap-m` |

---

## Alias Chain Rule

If Figma aliases `button/background → primitives/Neutral 900`, CSS must use `var(--neutral-900)`, not `#212121`.

---

## Audit Rules

- Never change source files to *hide* a divergence — report it.
- Always compare **both** modes.
- Naming violations are flagged regardless of whether the value is correct.
- When renaming: update declarations, all usages, then rebuild.
- When adding a token group: add CSS var + rule consumer + update `parity-map.mjs` + rebuild.
- When removing from DS: remove CSS var, remove from `parity-map.mjs`, run unused-var check.
