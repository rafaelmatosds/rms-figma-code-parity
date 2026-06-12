// structure-contract.mjs — Copy to your PROJECT ROOT and fill in your DS component contracts.
// This file is consumed by structure-check.mjs.

// ─── Structural contract (ground-truth per component, State=Default variant) ──
// Captured from live Figma via /rms-parity Phase 1.
// Fields:
//   h              — height in px, or 'auto'
//   paddingVar     — { tb: 'padding/token', lr: 'padding/token' } or null
//   gapVar         — 'gap/token' or null
//   fontSizeVar    — scale key ('m', 's', 'l') or null
//   fontWeightVar  — scale key or null
//   fillStructure  — 'direct' | 'before' | 'none'
//                    'before' = fill is on a child Background rect → CSS ::before
//   innerRadiusVar — 'radii/token' or null
//   strokeOnDefault — true if Figma State=Default has a stroke
export const CONTRACT = {
  // Example:
  // button: {
  //   h: 32,
  //   paddingVar: { tb: 'padding/s', lr: 'padding/m' },
  //   gapVar: 'gap/s',
  //   fontSizeVar: 'm', fontWeightVar: 'm',
  //   fillStructure: 'direct', innerRadiusVar: 'radii/button',
  //   strokeOnDefault: false,
  // },
};

// ─── CSS height/min-height rules to verify ────────────────────────────────────
// For each component with a fixed height, verify the CSS selector enforces it.
export const CSS_HEIGHT_RULES = {
  // Example:
  // button: { selector: '.button', prop: 'height' },
};

// ─── CSS base-rule var bindings to verify ────────────────────────────────────
// For multi-state components, verify the correct var is wired into the base rule.
// This catches "right value, wrong var" (e.g. --node-label instead of --node-label-unselected).
export const CSS_BASE_RULE_VARS = [
  // Example:
  // { key: 'node/label', selector: '.node', prop: 'color', expectedVar: '--node-label-unselected' },
];

// ─── Figma state/variant → CSS selector + var binding mapping ─────────────────
// Full verification chain per state (Gate [3]):
//   1. The CSS selector exists in your source files (theme CSS or plugin CSS)
//   2. The selector's rule uses the correct token var for each declared property
//   3. That token var resolves to the correct hex — Gate [2] covers this
//
// Fields:
//   component  — matches a key in CONTRACT above
//   figmaState — Figma variant property value (e.g. 'Hover', 'Disabled', 'Small')
//   selector   — CSS selector that activates this state in code
//   vars       — array of { prop, expectedVar }
//                prop        — CSS property name (e.g. 'background-color', 'color')
//                expectedVar — token var that MUST be used for this prop in this rule
//
// If vars is omitted, only selector existence is verified.
// If vars is present, both existence AND correct var binding are verified.
export const STATE_SELECTORS = [
  // {
  //   component:  'button',
  //   figmaState: 'Hover',
  //   selector:   '.button:hover',
  //   vars: [
  //     { prop: 'background-color', expectedVar: '--button-background-hover' },
  //     { prop: 'color',            expectedVar: '--button-text-hover' },
  //   ],
  // },
  // {
  //   component:  'button',
  //   figmaState: 'Disabled',
  //   selector:   '.button[disabled]',
  //   vars: [
  //     { prop: 'background-color', expectedVar: '--button-background-disabled' },
  //     { prop: 'color',            expectedVar: '--button-text-disabled' },
  //     { prop: 'border-color',     expectedVar: '--button-border-disabled' },
  //   ],
  // },
  // {
  //   component:  'input',
  //   figmaState: 'Focus',
  //   selector:   '.input:focus-within',
  //   vars: [
  //     { prop: 'border-color', expectedVar: '--input-border-focus' },
  //   ],
  // },
  // {
  //   component:  'input',
  //   figmaState: 'Error',
  //   selector:   '.input.error',
  //   vars: [
  //     { prop: 'border-color', expectedVar: '--input-border-error' },
  //     { prop: 'color',        expectedVar: '--input-label-error' },
  //   ],
  // },
  // {
  //   component:  'checkbox',
  //   figmaState: 'Selected',
  //   selector:   '.checkbox[checked]',
  //   vars: [
  //     { prop: 'background-color', expectedVar: '--checkbox-background-selected' },
  //     { prop: 'border-color',     expectedVar: '--checkbox-border-selected' },
  //   ],
  // },
];
