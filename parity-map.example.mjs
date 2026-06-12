// parity-map.mjs — Copy to your PROJECT ROOT and fill in your DS token mappings.
// This file is consumed by parity-check.mjs and bound-check.mjs.
// Do not commit ds-config.json / parity-map.mjs as submodule files —
// they live at the project root and are project-specific.

// ─── COLOR: Token path → CSS var name (when the naming convention doesn't produce the right var) ──
// Example: 'buttonPrimary/iconText': '--buttonPrimary-text'
// Convention: token/path/default → --token-path  (drop /default, /color; /iconText → /text; / → -)
export const EXPLICIT = {
  // Add your token→var exceptions here
};

// ─── Tokens that share a CSS var with another token (skip to avoid duplicate checking) ──
// Example: 'radioButton/background/selected' shares --radioButton-background
export const NULL_TOKENS = new Set([
  // Add tokens that deliberately share a CSS var
]);

// ─── Tokens with no CSS implementation (Figma chrome, unbound nodes, rgba-only) ──
export const SKIP_TOKENS = new Set([
  // Add tokens that are permanently un-implementable or intentionally deferred
]);

// ─── Tokens whose Figma value is legitimately null in the snapshot ──
export const KNOWN_NULL = new Set([
  // Add tokens where the Figma value is expected to be null
]);

// ─── SIZING: Token path → CSS var name (when convention doesn't apply) ──
export const EXPLICIT_SIZING = {
  // Example: 'radii/button': '--radius-full'
};

// ─── Sizing tokens with no CSS consumer — Map<token, reason> ──
export const SIZING_SKIP = new Map([
  // ['general/window-radii', 'Figma window-chrome — not controlled by HTML/CSS'],
]);

// ─── TYPOGRAPHY: CSS var → [scale, prop] snapshot path ──
// Only include vars that have a Figma text-style equivalent.
// Example: '--m-size': ['m', 'size']
export const TYPO = {
  // '--m-size':   ['m', 'size'],
  // '--m-weight': ['m', 'weight'],
  // '--m-lh':     ['m', 'lh'],
  // '--s-size':   ['s', 'size'],
  // '--s-weight': ['s', 'weight'],
  // '--s-lh':     ['s', 'lh'],
  // '--l-size':   ['l', 'size'],
};

// ─── BOUND-TOKEN COVERAGE: Tokens not given a dedicated CSS var ──
// These are covered by semantic aliases, shared primitives, or are un-implementable.
export const COVERED = new Set([
  // Add token paths that are intentionally deferred or covered by aliases
]);

// ─── Token path prefixes that are always deferred ──
export const COVERED_PREFIX = [
  // 'primitives/',
  // 'Settings/',
];
