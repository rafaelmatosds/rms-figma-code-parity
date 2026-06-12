// parity-check.mjs — Run from project root: node scripts/parity-check.mjs
// Resolves every CSS var chain for both light and dark modes and diffs against
// the Figma snapshot across three dimensions:
//   1. Color    — every component color token, both modes
//   2. Sizing   — gap / padding / radii / thickness / min-height
//   3. Typography — type scale (size, weight, line-height)
//
// Requires at project root:
//   ds-config.json   — themeCSS + snapshotVars paths
//   parity-map.mjs   — EXPLICIT, SKIP_TOKENS, NULL_TOKENS, KNOWN_NULL,
//                       EXPLICIT_SIZING, SIZING_SKIP, TYPO (optional, starts empty)
//
// Exit 0 = full parity. Exit 1 = at least one FAIL or NEW SKIP.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = process.cwd();

// ── Load ds-config.json ───────────────────────────────────────────────────────
let cfg = {};
try { cfg = JSON.parse(readFileSync(join(ROOT, 'ds-config.json'), 'utf8')); } catch {
  console.error('❌ ds-config.json not found at project root.'); process.exit(1);
}

const THEME_PATH    = cfg.paths?.themeCSS       ?? 'src/theme.css';
const SNAPSHOT_PATH = cfg.paths?.snapshotVars   ?? 'src/figma-vars.snapshot.json';

// ── Load parity-map.mjs (project-specific token mappings) ────────────────────
let EXPLICIT = {}, NULL_TOKENS = new Set(), SKIP_TOKENS = new Set(),
    KNOWN_NULL = new Set(), EXPLICIT_SIZING = {}, SIZING_SKIP = new Map(), TYPO = {};
// Primitive scale — export NEUTRAL_LIGHT / NEUTRAL_DARK from parity-map.mjs.
// Each is { key: '#hex' } where key matches the capture group in NEUTRAL_VAR_RE.
// Export NEUTRAL_VAR_RE (RegExp with one capture group) to override the var pattern.
// Default: matches --neutral-100, --neutral-200, etc.
let N_L = {}, N_D = {}, NEUTRAL_VAR_RE = /^--neutral-(\d+)$/;
try {
  const map = await import(join(ROOT, 'parity-map.mjs'));
  if (map.EXPLICIT)        EXPLICIT        = map.EXPLICIT;
  if (map.NULL_TOKENS)     NULL_TOKENS     = map.NULL_TOKENS;
  if (map.SKIP_TOKENS)     SKIP_TOKENS     = map.SKIP_TOKENS;
  if (map.KNOWN_NULL)      KNOWN_NULL      = map.KNOWN_NULL;
  if (map.EXPLICIT_SIZING) EXPLICIT_SIZING = map.EXPLICIT_SIZING;
  if (map.SIZING_SKIP)     SIZING_SKIP     = map.SIZING_SKIP;
  if (map.TYPO)            TYPO            = map.TYPO;
  if (map.NEUTRAL_LIGHT)   N_L             = map.NEUTRAL_LIGHT;
  if (map.NEUTRAL_DARK)    N_D             = map.NEUTRAL_DARK;
  if (map.NEUTRAL_VAR_RE)  NEUTRAL_VAR_RE  = map.NEUTRAL_VAR_RE;
} catch { /* parity-map.mjs optional — runs with empty maps */ }

// ── Parse theme.css ───────────────────────────────────────────────────────────
const rawCss = readFileSync(join(ROOT, THEME_PATH), 'utf8');
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

function parseVarBlock(block) {
  const vars = {};
  for (const m of block.matchAll(/--([a-zA-Z][a-zA-Z0-9-]*):\s*([^;]+);/g))
    vars['--' + m[1].trim()] = m[2].trim();
  return vars;
}

const rootMatch = css.match(/:root\s*{([\s\S]*?)}/);
const rootVars  = rootMatch ? parseVarBlock(rootMatch[1]) : {};
const darkMatch = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?:root\s*\{([\s\S]*?)\}\s*\}/);
const darkVars  = darkMatch ? parseVarBlock(darkMatch[1]) : {};

// ── Color resolver (mode-aware) ───────────────────────────────────────────────
function resolve(varName, mode, depth = 0) {
  if (depth > 8) return null;
  const nm = varName.match(NEUTRAL_VAR_RE);
  if (nm) return mode === 'light' ? (N_L[nm[1]] ?? N_L[+nm[1]]) : (N_D[nm[1]] ?? N_D[+nm[1]]);
  const raw = (mode === 'dark' && darkVars[varName]) ? darkVars[varName] : rootVars[varName];
  if (!raw) return null;
  const t = raw.trim();
  const vMatch  = t.match(/^var\((--.+?)\)$/);
  if (vMatch)  return resolve(vMatch[1], mode, depth + 1);
  const vfMatch = t.match(/^var\((--.+?),/);
  if (vfMatch) return resolve(vfMatch[1], mode, depth + 1);
  if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return t.toLowerCase();
  return null;
}

// ── Scalar resolver (single-mode: sizing + typography) ───────────────────────
function resolveScalar(varName, depth = 0) {
  if (depth > 8) return null;
  const raw = rootVars[varName]; if (!raw) return null;
  const t = raw.trim();
  const v  = t.match(/^var\((--.+?)\)$/);   if (v)  return resolveScalar(v[1],  depth + 1);
  const vf = t.match(/^var\((--.+?),/);      if (vf) return resolveScalar(vf[1], depth + 1);
  return t;
}

// ── Token → CSS var (convention: drop /default, /color; /iconText → /text; / → -) ──
function tokenToVar(token) {
  if (SKIP_TOKENS.has(token) || NULL_TOKENS.has(token)) return null;
  if (Object.prototype.hasOwnProperty.call(EXPLICIT, token)) return EXPLICIT[token];
  const v = token.replace(/\/iconText\//g, '/text/').replace(/\/default$/, '');
  return '--' + v.replace(/\//g, '-');
}

function sizingTokenToVar(token) {
  if (SIZING_SKIP.has(token)) return null;
  if (EXPLICIT_SIZING[token]) return EXPLICIT_SIZING[token];
  return '--' + token.replace(/\//g, '-');
}

// ── Load snapshot ─────────────────────────────────────────────────────────────
const snap = JSON.parse(readFileSync(join(ROOT, SNAPSHOT_PATH), 'utf8'));

// ── Accumulators ──────────────────────────────────────────────────────────────
const FAIL = [], PASS = [], SKIP = [], NEW_SKIP = [];

// ── 1. COLOR ──────────────────────────────────────────────────────────────────
const seen = new Set();
for (const mode of ['light', 'dark']) {
  for (const [tokenKey, figmaHex] of Object.entries(snap.color?.[mode] ?? {})) {
    const token = tokenKey.replace(/\/color$/, '');
    const dedupeKey = `${token}:${mode}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const cssVar = tokenToVar(token);
    if (cssVar === null) {
      SKIP.push({ dimension: 'color', token, mode, reason: 'no dedicated CSS var (known skip / shared primitive / rgba)' });
      continue;
    }
    if (figmaHex === null) {
      if (KNOWN_NULL.has(token)) SKIP.push({ dimension: 'color', token, mode, reason: 'Figma value null (known)' });
      else NEW_SKIP.push({ dimension: 'color', token, mode, reason: 'Figma value is NEW null — add to KNOWN_NULL in parity-map.mjs' });
      continue;
    }
    if (!rootVars[cssVar] && !darkVars[cssVar]) {
      FAIL.push({ dimension: 'color', token, cssVar, mode, issue: 'CSS var not declared in theme CSS' });
      continue;
    }
    const cssHex = resolve(cssVar, mode);
    if (cssHex === null) {
      NEW_SKIP.push({ dimension: 'color', token, cssVar, mode, reason: 'CSS resolves to non-hex — add to SKIP_TOKENS in parity-map.mjs if intentional' });
      continue;
    }
    if (figmaHex.toLowerCase() !== cssHex.toLowerCase())
      FAIL.push({ dimension: 'color', token, cssVar, mode, figma: figmaHex, css: cssHex, hint: `CSS resolves ${cssVar} → ${cssHex} but Figma says ${figmaHex}` });
    else
      PASS.push(`color ${token}:${mode}`);
  }
}

// ── 2. SIZING ─────────────────────────────────────────────────────────────────
for (const [token, figmaVal] of Object.entries(snap.sizing ?? {})) {
  const cssVar = sizingTokenToVar(token);
  if (cssVar === null) {
    SKIP.push({ dimension: 'sizing', token, mode: '-', reason: SIZING_SKIP.get(token) ?? 'no CSS var' });
    continue;
  }
  if (!rootVars[cssVar]) {
    FAIL.push({ dimension: 'sizing', token, cssVar, mode: '-', issue: 'CSS var not declared' });
    continue;
  }
  const cssVal = resolveScalar(cssVar);
  if (cssVal === null) {
    NEW_SKIP.push({ dimension: 'sizing', token, cssVar, mode: '-', reason: 'CSS var did not resolve to a literal' });
    continue;
  }
  if (String(figmaVal).trim() !== cssVal.trim())
    FAIL.push({ dimension: 'sizing', token, cssVar, mode: '-', figma: figmaVal, css: cssVal, hint: `CSS resolves ${cssVar} → ${cssVal} but Figma says ${figmaVal}` });
  else
    PASS.push(`sizing ${token}`);
}

// ── 3. TYPOGRAPHY ─────────────────────────────────────────────────────────────
if (snap.typography && Object.keys(TYPO).length) {
  for (const [cssVar, [scale, prop]] of Object.entries(TYPO)) {
    const figmaVal = snap.typography[scale]?.[prop];
    if (figmaVal === undefined || figmaVal === null) {
      SKIP.push({ dimension: 'typography', token: `${scale}/${prop}`, mode: '-', reason: 'no Figma value in snapshot' });
      continue;
    }
    if (!rootVars[cssVar]) {
      FAIL.push({ dimension: 'typography', token: `${scale}/${prop}`, cssVar, mode: '-', issue: 'CSS var not declared' });
      continue;
    }
    const cssVal = resolveScalar(cssVar);
    if (cssVal === null) {
      NEW_SKIP.push({ dimension: 'typography', token: `${scale}/${prop}`, cssVar, mode: '-', reason: 'CSS var did not resolve' });
      continue;
    }
    if (String(figmaVal).trim() !== cssVal.trim())
      FAIL.push({ dimension: 'typography', token: `${scale}/${prop}`, cssVar, mode: '-', figma: figmaVal, css: cssVal, hint: `CSS resolves ${cssVar} → ${cssVal} but Figma says ${figmaVal}` });
    else
      PASS.push(`typography ${scale}/${prop}`);
  }
} else if (!snap.typography) {
  SKIP.push({ dimension: 'typography', token: 'ALL', mode: '-', reason: 'snapshot has no typography section — run /rms-parity Phase 1' });
} else if (!Object.keys(TYPO).length) {
  SKIP.push({ dimension: 'typography', token: 'ALL', mode: '-', reason: 'TYPO map empty in parity-map.mjs — add your type scale vars' });
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`\n✅ PASS  ${PASS.length}   (color + sizing + typography)`);
console.log(`⏭  SKIP  ${SKIP.length}`);
console.log(`⚠️  NEW SKIP  ${NEW_SKIP.length}`);
console.log(`❌ FAIL  ${FAIL.length}`);

if (SKIP.length) {
  console.log('\n─── Skipped (expected — each has a documented reason) ─────────');
  for (const s of SKIP) console.log(`  ⏭  [${s.dimension}/${s.mode}] ${s.token} — ${s.reason}`);
}
if (NEW_SKIP.length) {
  console.log('\n─── ⚠️ NEW / UNEXPECTED SKIPS (must be signed off) ───────────');
  for (const s of NEW_SKIP) console.log(`  ⚠️  [${s.dimension}/${s.mode}] ${s.token} — ${s.reason}`);
}
if (FAIL.length) {
  console.log('\n─── Divergences ──────────────────────────────────────────────');
  for (const f of FAIL) {
    if (f.issue) console.log(`  ❌ [${f.dimension}/${f.mode}] ${f.token} → ${f.cssVar}: ${f.issue}`);
    else { console.log(`  ❌ [${f.dimension}/${f.mode}] ${f.token} → ${f.cssVar}`); console.log(`       Figma: ${f.figma}   CSS: ${f.css}`); }
  }
}
if (FAIL.length === 0 && NEW_SKIP.length === 0) {
  console.log('\nAll resolved CSS values match Figma snapshot. ✓\n');
  process.exit(0);
} else { console.log(''); process.exit(1); }
