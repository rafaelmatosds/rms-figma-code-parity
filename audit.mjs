// audit.mjs — Single-command parity audit runner.
// Run from project root: node scripts/audit.mjs  (or wherever this repo is mounted)
//
// Requires at project root:
//   ds-config.json   — paths, plugin list, known-unused vars
//
// Gates:
//   [1] Snapshot freshness    — warns if snapshots are stale (> 24 h)
//   [2] Parity check          — token values: color + sizing + typography
//   [3] Structure check       — heights + CSS base-rule var bindings
//   [4] Bound-token coverage  — every bound Figma token has a CSS var
//   [5] Unused var check      — no declared-but-orphaned CSS vars
//   [6] Hardcoded value scan  — no raw hex / px in CSS rules
//   [7] Build freshness       — source files not newer than built output
//   [8] Sub-component isolation — no broad element selector overrides sub-component styles
//
// Hard Rules (enforced across all gates):
//   • Hard Rule #2: every CSS var must have at least one rule consumer — no orphans
//   • Hard Rule #5: no hardcoded hex/px in CSS rules (declarations OK)
//   • Hard Rule #7: hidden Figma nodes (visible=false) are flagged but NEVER
//     implemented in code. A token whose only binding is on a hidden layer is
//     not a code requirement.
//   • Hard Rule #8: every DS sub-component nested inside another DS component
//     must retain its own CSS styles. A parent component's rule that uses a bare
//     element selector (e.g. .node svg { color: X }) will override inherited styles
//     from nested sub-components — direct targeting beats inheritance. Any such
//     broad rule must be in subcomponent-isolation-check.mjs's ALLOWED map.
//
// Exit 0 = all gates pass. Exit 1 = one or more failed.

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const today = new Date().toISOString().slice(0, 10);

// ── Load ds-config.json ───────────────────────────────────────────────────────
let cfg = {};
try {
  cfg = JSON.parse(readFileSync(join(ROOT, 'ds-config.json'), 'utf8'));
} catch {
  console.error('\n❌ ds-config.json not found at project root.');
  console.error('   Copy ds-config.example.json → ds-config.json and fill in your values.\n');
  process.exit(1);
}

const THEME       = cfg.paths?.themeCSS          ?? 'src/theme.css';
const SNAP_VARS   = cfg.paths?.snapshotVars       ?? 'src/figma-vars.snapshot.json';
const SNAP_STRUCT = cfg.paths?.snapshotStructure  ?? 'src/figma-structure.snapshot.json';
const PLUGIN_CSS  = cfg.paths?.pluginCSS          ?? [];
const PLUGINS     = cfg.paths?.plugins            ?? [];
const KNOWN_UNUSED     = new Set(cfg.knownUnusedVars         ?? []);
const KNOWN_FS_EXCEPTS = cfg.knownFontSizeExceptions         ?? [];

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const C = {
  bold:   s => isTTY ? `\x1b[1m${s}\x1b[0m`  : s,
  green:  s => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:    s => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: s => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  dim:    s => isTTY ? `\x1b[2m${s}\x1b[0m`  : s,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function sh(cmd, args = [], opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
}

function runScript(scriptPath) {
  const abs = resolve(SCRIPT_DIR, scriptPath);
  return sh('node', [abs]);
}

function snapshotAge(file) {
  try {
    const snap = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
    if (!snap._updated) return null;
    return Math.floor((Date.now() - new Date(snap._updated).getTime()) / 3_600_000);
  } catch { return null; }
}

function boundAge() {
  try {
    return Math.floor((Date.now() - statSync(join(ROOT, 'bound-tokens.json')).mtime) / 3_600_000);
  } catch { return null; }
}

// ── Gate runner ───────────────────────────────────────────────────────────────
const gates = [];
let anyFail = false;

function gate(label, fn) {
  const result = fn();
  if (!result.pass) anyFail = true;
  gates.push({ label, ...result });
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate 1 — Snapshot freshness
// ─────────────────────────────────────────────────────────────────────────────
gate('Snapshot freshness', () => {
  const vars   = snapshotAge(SNAP_VARS);
  const struct = snapshotAge(SNAP_STRUCT);
  const bnd    = boundAge();
  const lines = [];
  let warn = false;

  if (vars === null) {
    lines.push(C.red(`${SNAP_VARS} missing — run /rms-parity Phase 1`)); warn = true;
  } else if (vars > 24) {
    lines.push(C.yellow(`⚠️  ${SNAP_VARS} is ${vars}h old`)); warn = true;
  } else {
    lines.push(`${SNAP_VARS} ✓ (updated today)`);
  }

  if (struct === null) {
    lines.push(C.red(`${SNAP_STRUCT} missing — run /rms-parity Phase 1`)); warn = true;
  } else if (struct > 24) {
    lines.push(C.yellow(`⚠️  ${SNAP_STRUCT} is ${struct}h old`)); warn = true;
  } else {
    lines.push(`${SNAP_STRUCT} ✓ (updated today)`);
  }

  if (bnd === null) {
    lines.push(C.red('bound-tokens.json missing — run /rms-parity Phase 2 Step 1b')); warn = true;
  } else if (bnd > 24) {
    lines.push(C.yellow(`⚠️  bound-tokens.json is ${bnd}h old`)); warn = true;
  } else {
    lines.push(`bound-tokens.json ✓ (${bnd}h old)`);
  }

  return { pass: !warn, lines };
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate 2 — Parity check (token values: color + sizing + typography)
// ─────────────────────────────────────────────────────────────────────────────
gate('Token parity  (color · sizing · typography)', () => {
  const r = runScript('parity-check.mjs');
  const out = r.stdout + r.stderr;
  const pass = r.status === 0;
  const summary = out.split('\n').filter(l => /✅|❌|⚠️/.test(l) && l.trim()).map(l => l.trim());
  const failDetails = pass ? [] : out.split('\n')
    .filter(l => l.includes('❌') && !l.includes('FAIL  0'))
    .map(l => '  ' + l.trim()).slice(0, 20);
  return { pass, lines: [...summary, ...failDetails] };
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate 3 — Structure check
// ─────────────────────────────────────────────────────────────────────────────
gate('Structure     (snapshot · CSS height · base-rule vars)', () => {
  const r = runScript('structure-check.mjs');
  const out = r.stdout + r.stderr;
  const pass = r.status === 0;
  const summary = out.split('\n').filter(l => /✅|❌/.test(l) && l.trim()).map(l => l.trim());
  const failDetails = pass ? [] : out.split('\n')
    .filter(l => l.trim().startsWith('❌') && !l.includes('FAIL  0'))
    .map(l => '  ' + l.trim()).slice(0, 20);
  return { pass, lines: [...summary, ...failDetails] };
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate 4 — Bound-token coverage
// ─────────────────────────────────────────────────────────────────────────────
gate('Bound-token coverage  (DS frames → CSS vars)', () => {
  const r = runScript('bound-check.mjs');
  const out = r.stdout + r.stderr;

  if (r.status === 2) {
    return {
      pass: false,
      lines: [
        C.red('❌ HARD FAIL — bound-tokens.json missing.'),
        C.red('   Run /rms-parity Phase 2 Step 1b and save output to bound-tokens.json.'),
      ],
    };
  }

  const pass = r.status === 0;
  const summary = out.split('\n').filter(l => /COVERED|UNCOVERED/.test(l) && l.trim()).map(l => l.trim());
  const failDetails = pass ? [] : out.split('\n').filter(l => l.trim().startsWith('❌')).map(l => '  ' + l.trim()).slice(0, 20);
  return { pass, lines: [...summary, ...failDetails] };
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate 5 — Unused CSS vars (Hard Rule #2)
// ─────────────────────────────────────────────────────────────────────────────
gate('Unused CSS vars', () => {
  if (!existsSync(join(ROOT, THEME))) {
    return { pass: false, lines: [C.red(`theme CSS not found at ${THEME}`)] };
  }

  const themeText = readFileSync(join(ROOT, THEME), 'utf8');
  const declared = [...new Set(
    [...themeText.matchAll(/--([a-zA-Z][a-zA-Z0-9-]*)\s*:/g)].map(m => '--' + m[1])
  )];

  const srcFiles = [THEME, ...PLUGIN_CSS].filter(f => existsSync(join(ROOT, f)));
  const allSrc = srcFiles.map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');

  const unused = declared.filter(v => !KNOWN_UNUSED.has(v) && !allSrc.includes(`var(${v})`));
  const pass = unused.length === 0;
  return {
    pass,
    lines: pass
      ? [`✅ 0 unused vars  (${KNOWN_UNUSED.size} known-unused exempted)`]
      : [`❌ ${unused.length} unused: ${unused.join(', ')}`],
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate 6 — Hardcoded value scan (Hard Rule #5)
// ─────────────────────────────────────────────────────────────────────────────
gate('Hardcoded values  (no raw hex / font-size in rules)', () => {
  const scanTargets = [THEME, ...PLUGIN_CSS].filter(f => existsSync(join(ROOT, f)));
  const scanArgs = ['-n', '-E'];

  const hexR = sh('grep', [
    ...scanArgs,
    '(background|color|border|fill|stroke)\\s*:[^;]*#[0-9a-fA-F]{3,8}\\b',
    ...scanTargets,
  ]);

  const KNOWN_HEX_VARS = ['--swatch-stripe', '--semantic-positive', '--semantic-negative',
    '--semantic-warning', '--input-auto-border', '--overlay-bg', '--scrollbar-thumb', '--neutral-'];

  const hexHits = (hexR.stdout || '').split('\n').filter(l => {
    if (!l.trim()) return false;
    const codePart = l.replace(/^[^:]+:\d+:\s*/, '');
    if (/^\s*--[a-zA-Z]/.test(codePart)) return false;
    const stripped = codePart.replace(/\/\*[^*]*\*\//g, '');
    if (!/#[0-9a-fA-F]{3,8}\b/.test(stripped)) return false;
    if (KNOWN_HEX_VARS.some(k => l.includes(k))) return false;
    if (/color\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/i.test(codePart)) return false;
    return true;
  });

  const fsR = sh('grep', [
    ...scanArgs,
    'font-size\\s*:\\s*[0-9]+(\\.[0-9]+)?(px|rem|em)',
    ...scanTargets,
  ]);

  const fsHits = (fsR.stdout || '').split('\n').filter(l => {
    if (!l.trim()) return false;
    if (/[`"'].*font-size.*[`"']/.test(l)) return false;
    if (KNOWN_FS_EXCEPTS.some(e => l.includes(e.file) && l.includes(e.size))) return false;
    return true;
  });

  const hits = [...hexHits, ...fsHits];
  const pass = hits.length === 0;
  return {
    pass,
    lines: pass
      ? ['✅ Clean']
      : [`❌ ${hits.length} hit(s):`, ...hits.slice(0, 15).map(l => '  ' + l)],
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate 7 — Build freshness
// ─────────────────────────────────────────────────────────────────────────────
gate('Build freshness  (source ≤ built output)', () => {
  if (!PLUGINS.length) {
    return { pass: true, lines: ['⏭ No plugins configured in ds-config.json — skipped'] };
  }

  const stale = [];
  const themePath = join(ROOT, THEME);
  const themeMtime = existsSync(themePath) ? statSync(themePath).mtime : null;

  for (const p of PLUGINS) {
    const src = join(ROOT, `apps/${p}/ui.src.html`);
    const out = join(ROOT, `apps/${p}/ui.html`);
    if (!existsSync(src) || !existsSync(out)) continue;
    if (statSync(src).mtime > statSync(out).mtime) stale.push(p);
    else if (themeMtime && themeMtime > statSync(out).mtime && !stale.includes(p)) {
      stale.push(`${p} (theme newer)`);
    }
  }

  const pass = stale.length === 0;
  return {
    pass,
    lines: pass
      ? ['✅ All outputs current']
      : [`❌ Stale — rebuild: ${stale.join(', ')}`],
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate 8 — Sub-component style isolation (Hard Rule #8)
// ─────────────────────────────────────────────────────────────────────────────
gate('Sub-component isolation  (no parent rule overrides sub-component styles)', () => {
  const r = runScript('subcomponent-isolation-check.mjs');
  const out = r.stdout + r.stderr;
  const pass = r.status === 0;
  const summary = out.split('\n')
    .filter(l => /✅ DOCUMENTED|✅ No new|❌ UNDOCUMENTED/.test(l) && l.trim())
    .map(l => l.trim());
  const failDetails = pass ? [] : out.split('\n')
    .filter(l => l.trim().startsWith('❌') && !l.includes('UNDOCUMENTED'))
    .map(l => '  ' + l.trim()).slice(0, 20);
  return { pass, lines: [...summary, ...failDetails] };
});

// ── Final report ──────────────────────────────────────────────────────────────
const WIDTH = 60;
console.log('\n' + C.bold('─'.repeat(WIDTH)));
console.log(C.bold(`  PARITY AUDIT  ·  ${today}`));
console.log(C.bold('─'.repeat(WIDTH)) + '\n');

gates.forEach((g, i) => {
  const icon = g.pass ? C.green('✅') : C.red('❌');
  console.log(`${icon}  [${i + 1}] ${C.bold(g.label)}`);
  for (const line of g.lines || []) console.log(`       ${line}`);
  console.log();
});

console.log('─'.repeat(WIDTH));
if (anyFail) {
  console.log(C.bold(C.red('\n  AUDIT FAILED — fix all ❌ above before declaring parity\n')));
} else {
  console.log(C.bold(C.green('\n  ALL GATES PASS ✅\n')));
}
console.log('─'.repeat(WIDTH) + '\n');

process.exit(anyFail ? 1 : 0);
