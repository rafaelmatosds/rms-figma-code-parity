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
- `figma.colorCollection` — name of the color variable collection (e.g. `"Color"`)
- `figma.sizingCollection` — name of the sizing collection, if any (e.g. `"Sizing"`)
- `figma.darkMode` / `figma.lightMode` — mode names within the color collection
- `figma.primitivePrefix` — token path prefix to exclude from component token walks (e.g. `"primitives/"`)

Use these throughout all Figma queries. Never hardcode collection or mode names.

---

## Key Architecture Assumptions

- **CSS mode mapping:** how your DS maps Figma modes to CSS is defined in your project. Common patterns:
  - Light/Dark via `@media (prefers-color-scheme: dark)` → `:root { }`
  - Light/Dark via a `data-theme` attribute → `[data-theme="dark"] { }`
  - Single mode (no theming)
- **Token naming convention:** `token/path/default` → `--token-path` (drop `/default`, `/color`; `/` → `-`). Any additional shortenings specific to your DS are documented in `parity-map.mjs`.
- **Primitive scale:** your DS's primitive tokens (colors, spacing, etc.) are defined by you. Document them in `parity-map.mjs` under `NEUTRAL_LIGHT` / `NEUTRAL_DARK` (or equivalent) so the resolver can follow alias chains.
- **Snapshot files** at paths defined in `ds-config.json`.

---

## Hard Rules

1. **Every Figma component token must have a dedicated CSS variable.** No token may be covered only by an inline value. `via` is acceptable only when a semantic alias is documented in `parity-map.mjs`.
2. **Every CSS variable must be wired into at least one CSS rule.** A declared-but-unused var must be deleted. Variables are declared when the component exists in code, not before.
3. **Naming convention must be followed exactly.** A correct value under a wrong name is still a divergence.
4. **Both modes must match.** A token correct in dark but wrong in light is still a divergence.
5. **Hardcoded values in CSS rules are always flagged.** Colors must use `var(--)`, font-sizes must use scale vars, border widths and radii must use your DS sizing tokens. Raw literal values in a CSS rule (not a `:root` declaration) are a divergence. Document intentional exceptions in `ds-config.json → knownHardcodedExceptions`.
6. **New Figma component tokens detected during any audit step must be implemented in code before the audit closes.**
7. **Hidden elements (visible=false) in Figma are flagged but never implemented in code.** A token bound only to a hidden layer is `⚠️ HIDDEN — not implemented`. Never add a CSS var for a token whose only binding is on a hidden node.
8. **Every DS sub-component nested inside another DS component must retain its own CSS styles.** A parent component's rule that combines a component class with a bare element tag (`.card svg { color: X }`) directly targets that element — direct targeting beats inheritance. When adding any CSS rule of the form `.<componentClass> <elementTag> { <visual-property> }`, either (a) prove it's a leaf component, or (b) add explicit `.<subComponent> <elementTag> { }` overrides later in the cascade. Add every such rule to the `ALLOWED` map in `subcomponent-isolation-check.mjs`. Gate [8] enforces this mechanically.

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

Use `figma.colorCollection`, `figma.darkMode`, `figma.lightMode`, `figma.sizingCollection`, and `figma.primitivePrefix` from `ds-config.json`.

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

// Use collection/mode names from ds-config.json
const COLOR_COLLECTION = 'YOUR_COLOR_COLLECTION'; // e.g. "Color"
const DARK_MODE        = 'YOUR_DARK_MODE';         // e.g. "Dark"
const LIGHT_MODE       = 'YOUR_LIGHT_MODE';        // e.g. "Light"
const SIZING_COLLECTION = 'YOUR_SIZING_COLLECTION'; // e.g. "Sizing", or null if not used
const PRIMITIVE_PREFIX  = 'YOUR_PRIMITIVE_PREFIX';  // e.g. "primitives/"

const col = collections.find(c => c.name === COLOR_COLLECTION);
const darkId  = col.modes.find(m => m.name === DARK_MODE).modeId;
const lightId = col.modes.find(m => m.name === LIGHT_MODE).modeId;
const colorOut = { dark: {}, light: {} };
for (const id of col.variableIds) {
  const v = idToVar[id];
  if (!v || v.resolvedType !== 'COLOR' || v.name.startsWith(PRIMITIVE_PREFIX)) continue;
  colorOut.dark[v.name]  = resolveInMode(id, darkId).hex;
  colorOut.light[v.name] = resolveInMode(id, lightId).hex;
}

const sizingOut = {};
if (SIZING_COLLECTION) {
  const sizingCol = collections.find(c => c.name === SIZING_COLLECTION);
  if (sizingCol) {
    const modeId = sizingCol.modes[0].modeId;
    for (const id of sizingCol.variableIds) {
      const v = idToVar[id]; if (!v) continue;
      const val = v.valuesByMode[modeId] ?? Object.values(v.valuesByMode)[0];
      sizingOut[v.name] = typeof val === 'number' ? val + 'px' : String(val);
    }
  }
}

// Typography — capture ALL local text styles, keyed by last path segment
const WEIGHT = {'Thin':100,'Extra Light':200,'Light':300,'Regular':400,'Medium':500,'Semi Bold':600,'Bold':700,'Extra Bold':800,'Black':900};
const styles = await figma.getLocalTextStylesAsync();
const typo = {};
for (const st of styles) {
  const key = st.name.trim().toLowerCase().split('/').pop();
  const entry = { size: Math.round(st.fontSize * 10) / 10 + 'px' };
  const w = WEIGHT[st.fontName.style]; if (w) entry.weight = String(w);
  if (st.lineHeight?.unit === 'PIXELS') entry.lh = Math.round(st.lineHeight.value * 10) / 10 + 'px';
  typo[key] = entry;
}
return { color: colorOut, sizing: sizingOut, typography: typo };
```

> Fill in the four config constants at the top from `ds-config.json`. If your DS has no sizing collection or no text styles, those sections will be empty — that's fine.

---

## Phase 1 — Step 1c: Capture component structure → `figma-structure.snapshot.json`

Navigate to your DS Components page, find each `COMPONENT_SET`, navigate to the `State=Default` child (never the SET — its height equals all variants stacked), and extract structural facts:

```js
// Extract: h, paddingVar {tb,lr}, gapVar, fontSizeVar, fontWeightVar,
//          fillStructure ('direct' | 'before' | 'none'), innerRadiusVar, strokeOnDefault
// fillStructure = 'before' when fill is on a child "Background" rect (→ CSS ::before)
//                 'direct' when on the frame itself
//                 'none' when default state has no fill
// strokeOnDefault = node.strokes?.length > 0 on the State=Default variant
```

Write the result in this shape:
```json
{
  "_updated": "YYYY-MM-DD",
  "_note": "Auto-generated by /rms-parity. Do not edit manually.",
  "components": {
    "button": { "h": 32, "paddingVar": { "tb": "padding/s", "lr": "padding/m" }, "gapVar": "gap/s", ... }
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
**New tokens** → 🆕 needs CSS var (Hard Rule #1)
**Removed tokens** → 🗑 check if CSS var can be removed

If diff is empty: print `✅ No DS changes since last snapshot (YYYY-MM-DD).`

---

## Phase 1 — Step 4: Impact analysis

For every changed or new token:
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

Walk all DS frames and capture every token bound to at least one **visible** node. Skip `visible=false` nodes (Hard Rule #7). Use frame IDs from `ds-config.json → frames`.

```js
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const idToVar = {};
for (const col of collections) {
  for (const id of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id); if (v) idToVar[id] = v;
  }
}
const PRIMITIVE_PREFIX = 'YOUR_PRIMITIVE_PREFIX'; // from ds-config.json
// frameIds from ds-config.json → frames[].nodeId
const frameIds = ['YOUR_FRAME_NODE_ID_1', 'YOUR_FRAME_NODE_ID_2'];
const used = {}, hidden = {};
for (const fid of frameIds) {
  const frame = figma.currentPage.findOne(n => n.id === fid); if (!frame) continue;
  function walk(node, ancestorHidden = false) {
    const isHidden = ancestorHidden || node.visible === false;
    if (node.boundVariables) {
      for (const [prop, binding] of Object.entries(node.boundVariables)) {
        for (const b of (Array.isArray(binding) ? binding : [binding])) {
          if (!b?.id) continue;
          const v = idToVar[b.id];
          if (!v || v.name.startsWith(PRIMITIVE_PREFIX)) continue;
          const bucket = isHidden ? hidden : used;
          if (!bucket[v.name]) bucket[v.name] = [];
          bucket[v.name].push({ frame: fid, nodeId: node.id, nodeName: node.name, prop });
        }
      }
    }
    if ('children' in node) node.children.forEach(c => walk(c, isHidden));
  }
  walk(frame);
}
if (Object.keys(hidden).length) console.log('⚠️ HIDDEN tokens (Hard Rule #7 — not implemented):', Object.keys(hidden));
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

For every DS component, walk all states and extract fill/stroke/padding/gap/radius/text with bound variable names. Use the `describe()` pattern:

```js
function getVar(node, prop) {
  const bv = node.boundVariables?.[prop]; if (!bv) return null;
  const ref = Array.isArray(bv) ? bv[0] : bv;
  return idToVar[ref?.id]?.name || null;
}
function toHex(c) { return '#'+[c.r,c.g,c.b].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join(''); }
function describe(n, depth=0) {
  const o = { id: n.id, name: n.name, type: n.type, w: Math.round(n.width), h: Math.round(n.height) };
  try { if (n.layoutMode) o.layoutMode = n.layoutMode; } catch{}
  try { o.padding = {t:n.paddingTop,r:n.paddingRight,b:n.paddingBottom,l:n.paddingLeft};
        o.paddingVar = getVar(n,'paddingTop') || getVar(n,'paddingLeft'); } catch{}
  try { if (n.itemSpacing) { o.gap = n.itemSpacing; o.gapVar = getVar(n,'itemSpacing'); } } catch{}
  try { if (n.cornerRadius && n.cornerRadius !== figma.mixed) { o.radius=n.cornerRadius; o.radiusVar=getVar(n,'cornerRadius'); } } catch{}
  try { if (n.fills?.length && n.fills[0].type==='SOLID') { o.fill=toHex(n.fills[0].color); o.fillVar=getVar(n,'fills'); } } catch{}
  try {
    if (n.strokes?.length) {
      o.strokeVar=getVar(n,'strokes'); o.strokeWeight=n.strokeWeight;
      o.strokeStyle=(n.dashPattern?.length>0)?'dashed':'solid';
    } else { o.strokes='none'; }
  } catch{}
  try { if (n.type==='TEXT') { o.fontSize=n.fontSize; o.fontWeight=n.fontWeight; o.textFillVar=getVar(n,'fills'); } } catch{}
  if (depth<3 && n.children) o.children=n.children.map(c=>describe(c,depth+1));
  return o;
}
```

**Critical:** always query `State=Default` CHILD, never the SET.

**Stroke presence rule:** if `strokes: 'none'` on the Default state → CSS must use a transparent border (`border: ... solid transparent`). Never use a token color on the default state's border.

Compare results against your `structure-contract.mjs`. Any drift → update contract AND CSS together.

---

## Phase 2 — Step 4: Hardcoded value scan (A–F)

Run across all production CSS files:

**A.** Hex colors in rules (not `:root` declarations) — must use `var(--)` 
**B.** Hardcoded font sizes — must use your scale vars
**C.** Hardcoded border radius — must use your sizing token vars
**D.** Hardcoded border widths — must use your sizing token vars
**E.** Hardcoded spacing — must use your gap/padding token vars
**F.** JS inline styles (`element.style.color = ...`)

Document intentional exceptions in `ds-config.json → knownHardcodedExceptions`.

---

## Phase 2 — Step 5: State coverage check

For every DS component with multiple states, verify a corresponding CSS rule exists and is reachable.

---

## Phase 2 — Step 6: Mode override completeness

Every token where the two modes have different values must have an explicit CSS override for the non-default mode (or use a self-resolving var that already carries both values). Gate [2] catches this automatically for all tokens in the snapshot.

---

## Phase 2 — Step 7: Screenshots

Use `get_screenshot` with `figmaFileKey` and each `frames[].nodeId` from `ds-config.json`. Compare against prior screenshots. Flag any visible difference not already surfaced by the automated gates.

---

## Phase 2 — Step 8: Build freshness

If your project has a build step:

```bash
# rebuild, then check for uncommitted changes in built output
git status --short -- '<your built output paths>'
```

Expected: empty output. Any listed file = stale build.

---

## Phase 2 — Step 9: Master Token Table

Produce one table covering every Figma component token:

| Figma token | CSS var | Name | Mode A Figma | Mode A Code | A | Mode B Figma | Mode B Code | B | Alias |
|---|---|---|---|---|---|---|---|---|---|

- `none` = token exists in Figma, no CSS var yet
- `via --alias` = covered by a semantic alias documented in `parity-map.mjs`
- `~` = Figma value null/missing
- **Mode A Code / Mode B Code must show the actual resolved value**, not just the var reference

After the table: Divergence summary (❌ rows), Unused vars, New Figma tokens.

---

## Naming Convention

The base rule for all DS token → CSS var mappings:

| Rule | Notes |
|---|---|
| Token path → CSS var | `component/property/state` → `--component-property-state` |
| Drop `/default` state | Base token has no state suffix |
| Drop `/color` suffix | Always omit |
| `/` → `-` | Path separator becomes hyphen |
| Preserve camelCase | Component names stay as-is |
| State names verbatim | `active`, `selected`, `hover`, `disabled` — never substitute |

Any DS-specific shortenings (e.g. a specific segment that maps to a different word) are documented in `parity-map.mjs` under `EXPLICIT`.

---

## Alias Chain Rule

If Figma aliases `component/background → primitives/SomeToken`, CSS must use `var(--some-token)` — never a hardcoded literal. The alias chain must be fully traceable through CSS `var()` references.

Document your primitive → CSS var mapping in `parity-map.mjs` under `NEUTRAL_LIGHT` / `NEUTRAL_DARK` (or equivalent for your DS's primitive scale) so the resolver can follow chains automatically.

---

## Audit Rules

- Never change source files to *hide* a divergence — report it.
- Always compare **both** modes.
- Naming violations are flagged regardless of whether the value is correct.
- When renaming: update declarations, all usages, then rebuild.
- When adding a token group: add CSS var + rule consumer + update `parity-map.mjs` + rebuild.
- When removing from DS: remove CSS var, remove from `parity-map.mjs`, run unused-var check.
