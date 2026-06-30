// component-slot-check.mjs — Gate [14]: Component slot parity
// Run from project root: node ../rms-figma-code-parity/component-slot-check.mjs
//
// For every entry in COMPONENT_USAGES (structure-contract.mjs), locates the element
// by selector in the plugin's static HTML source and verifies the element's class
// attribute contains the expected DS component class.
//
// Exit 0 = all component slots match. Exit 1 = any mismatch.

import { readFileSync, existsSync } from 'fs';
import { join }                     from 'path';

const ROOT = process.cwd();

let cfg = {};
try { cfg = JSON.parse(readFileSync(join(ROOT, 'ds-config.json'), 'utf8')); } catch {
  console.error('❌ ds-config.json not found at project root.'); process.exit(1);
}

let COMPONENT_USAGES = [];
try {
  const m = await import(join(ROOT, 'structure-contract.mjs'));
  if (m.COMPONENT_USAGES && Array.isArray(m.COMPONENT_USAGES)) COMPONENT_USAGES = m.COMPONENT_USAGES;
} catch { /* optional — skip if not present */ }

if (!COMPONENT_USAGES.length) {
  console.log('⚠️  COMPONENT_USAGES not found in structure-contract.mjs — skipping Gate [14]');
  process.exit(0);
}

const pluginToSrc = {};
const pluginCSS = cfg.paths?.pluginCSS ?? [];
const plugins   = cfg.paths?.plugins   ?? [];
for (let i = 0; i < plugins.length; i++) {
  if (pluginCSS[i]) pluginToSrc[plugins[i]] = pluginCSS[i];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Find the element opening tag matching the selector and extract its class attribute.
function findClassInSlot(html, selector) {
  let elemRe;
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    elemRe = new RegExp(`<[a-z]+[^>]*\\bid="${escapeRe(id)}"[^>]*>`, 'i');
  } else if (selector.startsWith('.')) {
    const cls = selector.slice(1);
    elemRe = new RegExp(`<[a-z]+[^>]*\\bclass="[^"]*\\b${escapeRe(cls)}\\b[^"]*"[^>]*>`, 'i');
  } else {
    return null;
  }

  const m = elemRe.exec(html);
  if (!m) return null;

  const tag  = m[0];
  const clsM = /\bclass="([^"]*)"/.exec(tag);
  return clsM ? clsM[1] : '';
}

// ── Run checks ────────────────────────────────────────────────────────────────
let pass = true;

for (const entry of COMPONENT_USAGES) {
  const { plugin, selector, expectedClass } = entry;
  const srcPath = pluginToSrc[plugin];
  if (!srcPath) {
    console.log(`⚠️  [14] ${plugin}: no source HTML in ds-config.json — skipping`);
    continue;
  }

  const absPath = join(ROOT, srcPath);
  if (!existsSync(absPath)) {
    console.log(`⚠️  [14] ${plugin} ${selector}: ${srcPath} not found — skipping`);
    continue;
  }

  const html      = readFileSync(absPath, 'utf8');
  const classAttr = findClassInSlot(html, selector);

  if (classAttr === null) {
    console.log(`❌ [14] ${plugin} ${selector}: element not found in HTML`);
    pass = false;
  } else {
    const classes = classAttr.split(/\s+/);
    if (!classes.includes(expectedClass)) {
      console.log(`❌ [14] ${plugin} ${selector}: expected class "${expectedClass}", got "${classAttr}"`);
      pass = false;
    } else {
      console.log(`✅ [14] ${plugin} ${selector}: "${expectedClass}" ✓`);
    }
  }
}

process.exit(pass ? 0 : 1);
