// icon-check.mjs — Run from project root: node ../rms-figma-code-parity/icon-check.mjs
//
// Hard Rule #15 — SVG symbol audit:
//   Every <symbol> defined in any plugin HTML file must be declared in ICON_SYMBOLS
//   in structure-contract.mjs with either:
//     DS ICON         — sourced from the Figma DS; must record the Figma node ID
//     PLUGIN-SPECIFIC — custom icon with no DS backing; must describe visual purpose
//
//   ICON_SYMBOLS values can be a string OR an object:
//     String:  'DS ICON — ...' | 'PLUGIN-SPECIFIC — ...'
//     Object:  { desc: 'DS ICON — ...', transform?: 'rotate(-45)', size?: 16 }
//              transform — if set, symbol must contain <g transform="..."> matching value
//              size      — if set, every <svg width="N" height="N"><use href="#id"> must
//                          use that exact width/height; catches icons rendered at wrong size
//
//   Why: hand-drawn paths, missing transforms, and wrong render sizes all produce
//   visually wrong icons that no color/token check would catch.
//
// Requires at project root:
//   ds-config.json         — paths.pluginCSS (HTML files to scan for <symbol> elements)
//   structure-contract.mjs — ICON_SYMBOLS export
//
// Exit 0 = all symbols documented, transforms and sizes verified. Exit 1 = failures found.

import { readFileSync, existsSync } from 'fs';
import { join }                     from 'path';

const ROOT = process.cwd();

// ── Load ds-config.json ───────────────────────────────────────────────────────
let cfg = {};
try { cfg = JSON.parse(readFileSync(join(ROOT, 'ds-config.json'), 'utf8')); } catch {
  console.error('❌ ds-config.json not found at project root.'); process.exit(1);
}

const HTML_SOURCES = [
  ...(cfg.paths?.pluginCSS        ?? []).filter(f => existsSync(join(ROOT, f)) && f.endsWith('.html')),
  ...(cfg.paths?.sharedIconSources ?? []).filter(f => existsSync(join(ROOT, f))),
];

// ── Load ICON_SYMBOLS from structure-contract.mjs ─────────────────────────────
let ALLOWED = {};
try {
  const m = await import(join(ROOT, 'structure-contract.mjs'));
  if (m.ICON_SYMBOLS && typeof m.ICON_SYMBOLS === 'object') ALLOWED = m.ICON_SYMBOLS;
} catch { /* optional export */ }

function entryDesc(val)        { return typeof val === 'string' ? val : val.desc; }
function entryTransform(val)   { return typeof val === 'string' ? null  : (val.transform   ?? null); }
function entrySize(val)        { return typeof val === 'string' ? null  : (val.size        ?? null); }
function entryStrokeNone(val)  { return typeof val === 'string' ? false : (val.strokeNone  ?? false); }
function entryStrokeBased(val) { return typeof val === 'string' ? false : (val.strokeBased ?? false); }

// ── Extract <symbol id="...">...</symbol> blocks from HTML files ──────────────
// Captures the full symbol body so we can check for transform attributes.
const SYMBOL_BLOCK_RE = /<symbol\s([^>]*)>([\s\S]*?)<\/symbol>/g;
const ID_RE           = /\bid="([^"]+)"/;

const documented       = [];
const undocumented     = [];
const transformFails   = [];
const sizeFails        = [];
const strokeFails      = [];
const strokeBasedFails = [];

for (const srcPath of HTML_SOURCES) {
  const text = readFileSync(join(ROOT, srcPath), 'utf8');
  let m;
  SYMBOL_BLOCK_RE.lastIndex = 0;
  while ((m = SYMBOL_BLOCK_RE.exec(text)) !== null) {
    const attrs = m[1], body = m[2];
    const idMatch = ID_RE.exec(attrs);
    if (!idMatch) continue;
    const id  = idMatch[1];
    const val = ALLOWED[id];

    if (!val) {
      undocumented.push({ id, file: srcPath });
      continue;
    }

    const desc            = entryDesc(val);
    const reqTransform    = entryTransform(val);
    const reqSize         = entrySize(val);
    const reqStrokeNone   = entryStrokeNone(val);
    const reqStrokeBased  = entryStrokeBased(val);

    if (reqStrokeBased) {
      // Verify the <symbol> tag itself has fill="none" — ensures stroke-based rendering.
      // Catches a fill-based SVG replacing a stroke DS icon without any size/color gate failing.
      const hasFillNone = /\bfill="none"/.test(attrs) || /\bfill='none'/.test(attrs);
      if (!hasFillNone) {
        strokeBasedFails.push({ id, file: srcPath, desc });
        continue;
      }
    }

    if (reqTransform) {
      const hasTransform = body.includes(`transform="${reqTransform}"`) ||
                           body.includes(`transform='${reqTransform}'`);
      if (!hasTransform) {
        transformFails.push({ id, reqTransform, file: srcPath, desc });
        continue;
      }
    }

    if (reqStrokeNone) {
      // Verify the symbol body contains stroke="none" on a path/shape element.
      // This prevents CSS-inherited stroke (e.g. .buttonTertiary svg { stroke: ... })
      // from making fill-only icons appear thicker in button contexts than elsewhere.
      const hasStrokeNone = /stroke="none"/.test(body) || /stroke='none'/.test(body);
      if (!hasStrokeNone) {
        strokeFails.push({ id, file: srcPath, desc });
        continue;
      }
    }

    if (reqSize !== null) {
      // Find every <use href="#id"> (or xlink:href) in the file, then check
      // the nearest enclosing <svg> opening tag for matching width/height.
      const USE_RE = new RegExp(`<use\\s[^>]*(?:href|xlink:href)=["']#${id}["'][^>]*>`, 'g');
      let um;
      USE_RE.lastIndex = 0;
      while ((um = USE_RE.exec(text)) !== null) {
        // Walk backwards from match position to find the most recent <svg ...> opening tag
        const before    = text.slice(0, um.index);
        const svgTagIdx = before.lastIndexOf('<svg');
        if (svgTagIdx === -1) continue;
        // Extract the full opening tag (up to the first >)
        const svgTagEnd = text.indexOf('>', svgTagIdx);
        const svgTag    = text.slice(svgTagIdx, svgTagEnd + 1);
        const wMatch    = /\bwidth="(\d+(?:\.\d+)?)"/.exec(svgTag);
        const hMatch    = /\bheight="(\d+(?:\.\d+)?)"/.exec(svgTag);
        const w = wMatch ? parseFloat(wMatch[1]) : null;
        const h = hMatch ? parseFloat(hMatch[1]) : null;
        if (w !== reqSize || h !== reqSize) {
          sizeFails.push({ id, reqSize, actual: `${w}×${h}`, file: srcPath, desc });
        }
      }
    }

    documented.push({ id, desc, file: srcPath });
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log('\n─── SVG symbol audit (Hard Rule #15) ───────────────────────────────\n');

if (documented.length) {
  console.log(`✅ DOCUMENTED  ${documented.length}  (SVG symbols declared and verified in contract)`);
  for (const r of documented) {
    const tag = r.desc.startsWith('DS ICON') ? '✅ DS    ' : '✅ PLUGIN';
    console.log(`   ${tag}  #${r.id}`);
    console.log(`            ${r.desc}`);
  }
  console.log();
}

const allFails = [
  ...undocumented.map(r => ({ ...r, kind: 'undocumented' })),
  ...strokeBasedFails.map(r => ({ ...r, kind: 'strokeBased' })),
  ...transformFails.map(r => ({ ...r, kind: 'transform' })),
  ...sizeFails.map(r => ({ ...r, kind: 'size' })),
  ...strokeFails.map(r => ({ ...r, kind: 'stroke' })),
];

if (allFails.length === 0) {
  console.log('✅ No undocumented or misconfigured SVG symbols.\n');
  process.exit(0);
}

if (undocumented.length) {
  console.log(`❌ UNDOCUMENTED  ${undocumented.length}  (SVG symbols with no contract entry)\n`);
  for (const r of undocumented) {
    console.log(`   ❌ "#${r.id}"  in ${r.file}`);
    console.log(`      → DS icon? Fetch from Figma (get_design_context), add as DS ICON with nodeId.`);
    console.log(`        Also check: does the Figma component apply a rotation wrapper? If so, add transform field.`);
    console.log(`        Custom icon? Add as PLUGIN-SPECIFIC with a description.\n`);
  }
}

if (transformFails.length) {
  console.log(`❌ MISSING TRANSFORM  ${transformFails.length}  (DS icons require a <g transform> that is absent)\n`);
  for (const r of transformFails) {
    console.log(`   ❌ "#${r.id}"  in ${r.file}`);
    console.log(`      Contract requires: <g transform="${r.reqTransform}">`);
    console.log(`      → Figma component applies this rotation to orient the path correctly.`);
    console.log(`        Wrap the <path> in: <g transform="${r.reqTransform}">...</g>\n`);
  }
}

if (sizeFails.length) {
  console.log(`❌ WRONG RENDER SIZE  ${sizeFails.length}  (DS icon rendered at wrong width/height)\n`);
  for (const r of sizeFails) {
    console.log(`   ❌ "#${r.id}"  in ${r.file}`);
    console.log(`      Contract requires: ${r.reqSize}×${r.reqSize}  —  found: ${r.actual}`);
    console.log(`      → The DS component specifies a ${r.reqSize}px container. Update the <svg width="${r.reqSize}" height="${r.reqSize}"> that wraps <use href="#${r.id}">.\n`);
  }
}

if (strokeBasedFails.length) {
  console.log(`❌ NOT STROKE-BASED  ${strokeBasedFails.length}  (DS stroke icons must have fill="none" on <symbol> tag)\n`);
  for (const r of strokeBasedFails) {
    console.log(`   ❌ "#${r.id}"  in ${r.file}`);
    console.log(`      Contract requires strokeBased: true — <symbol> tag must have fill="none" attribute.`);
    console.log(`      → The DS icon uses stroke rendering (not fill). A fill-based replacement would have`);
    console.log(`        wrong visual weight. Add fill="none" to the <symbol ...> opening tag.\n`);
  }
}

if (strokeFails.length) {
  console.log(`❌ MISSING STROKE=NONE  ${strokeFails.length}  (fill-only DS icons missing stroke="none" guard)\n`);
  for (const r of strokeFails) {
    console.log(`   ❌ "#${r.id}"  in ${r.file}`);
    console.log(`      Contract requires strokeNone: true — no stroke="none" found on any element inside the symbol.`);
    console.log(`      → Broad CSS rules (e.g. .buttonTertiary svg { stroke: ... }) will inherit stroke into fill-only`);
    console.log(`        paths, making the icon appear thicker in button contexts than in other contexts.`);
    console.log(`        Add stroke="none" to the <path> inside the symbol to prevent inherited stroke.\n`);
  }
}

process.exit(1);
