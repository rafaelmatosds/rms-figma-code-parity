// consumer-audit.mjs — Consumer Figma file coverage audit.
//
// Compares a consumer file's local variable collection (brand overrides) against
// the DS snapshot to find tokens the consumer file is missing — i.e. new DS tokens
// not yet adopted by the consumer.
//
// Usage (run from the DS project root):
//   node consumer-audit.mjs --file <consumerFileKey>
//   node consumer-audit.mjs --file GfHErcAjjw277iPunsZXCU
//
// Requires:
//   ds-config.json         — snapshotVars path + figma.colorCollection + figma.modes
//   .env                   — FIGMA_TOKEN (personal access token with "File content" read scope)
//
// IMPORTANT — Library detection:
//   The ONLY reliable way to detect DS library linkage is via the Figma Variables REST API
//   (/files/:key/variables/local), which returns each collection with a `remote` flag:
//     remote: false → collection is local to the consumer file (brand overrides)
//     remote: true  → collection is from a linked library (the DS)
//
//   NEVER infer library linkage from component names in get_metadata / page structure.
//   Consumer files wrap DS instances in local components — the wrapper names (list-item,
//   button-primary, etc.) reveal nothing about library linkage.
//
// Output:
//   Prints a coverage report: DS tokens missing from consumer's local collection,
//   grouped by component prefix. Writes consumer-audit-report.json at project root.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

// ── CLI args ──────────────────────────────────────────────────────────────────
const fileArgIdx = process.argv.indexOf('--file');
const CONSUMER_KEY = fileArgIdx !== -1 ? process.argv[fileArgIdx + 1] : null;
if (!CONSUMER_KEY) {
  console.error('❌ Usage: node consumer-audit.mjs --file <consumerFileKey>');
  console.error('   Example: node consumer-audit.mjs --file GfHErcAjjw277iPunsZXCU');
  process.exit(1);
}

// ── Load ds-config.json ───────────────────────────────────────────────────────
let cfg = {};
try { cfg = JSON.parse(readFileSync(join(ROOT, 'ds-config.json'), 'utf8')); } catch {
  console.error('❌ ds-config.json not found at project root.'); process.exit(1);
}
const SNAP_PATH        = cfg.paths?.snapshotVars ?? 'figma-vars.snapshot.json';
const COLOR_COLLECTION = cfg.figma?.colorCollection ?? 'Theme';
const MODES            = (cfg.figma?.modes ?? [
  { name: 'Light', snapshotKey: 'light' },
  { name: 'Dark',  snapshotKey: 'dark'  },
]);
const PRIM_PFX         = cfg.figma?.primitivePrefix ?? 'primitives/';

// ── Load FIGMA_TOKEN ──────────────────────────────────────────────────────────
let FIGMA_TOKEN = process.env.FIGMA_TOKEN ?? '';
if (!FIGMA_TOKEN && existsSync(join(ROOT, '.env'))) {
  const env = readFileSync(join(ROOT, '.env'), 'utf8');
  const m = env.match(/^FIGMA_TOKEN\s*=\s*(.+)$/m);
  if (m) FIGMA_TOKEN = m[1].trim();
}
if (!FIGMA_TOKEN) {
  console.error('❌ FIGMA_TOKEN not set. Add it to .env at the project root.');
  console.error('   Get it from Figma → Account Settings → Personal access tokens (File content: Read).');
  process.exit(1);
}

// ── Load DS snapshot ──────────────────────────────────────────────────────────
let snap;
try { snap = JSON.parse(readFileSync(join(ROOT, SNAP_PATH), 'utf8')); } catch {
  console.error(`❌ DS snapshot not found: ${SNAP_PATH}`);
  console.error('   Run /rms-parity Phase 1 first to capture the snapshot.');
  process.exit(1);
}

// Build a set of all DS component token names (excluding primitives)
const dsTokens = new Set();
for (const mode of MODES) {
  const modeTokens = snap.color?.[mode.snapshotKey] ?? {};
  for (const name of Object.keys(modeTokens)) {
    if (!name.startsWith(PRIM_PFX)) dsTokens.add(name);
  }
}
console.log(`\n📐 DS snapshot: ${dsTokens.size} component tokens across ${MODES.length} mode(s)`);

// ── Query consumer file variables via Figma REST API ─────────────────────────
console.log(`\n🔍 Fetching variable collections from consumer file: ${CONSUMER_KEY}`);
console.log('   (Using Figma REST API — no edit access required)\n');

async function fetchFigmaVars(fileKey) {
  const url = `https://api.figma.com/v1/files/${fileKey}/variables/local`;
  const res = await fetch(url, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN },
  });
  if (res.status === 403) {
    console.error('❌ Figma API returned 403. Check that FIGMA_TOKEN has "File content: Read" scope');
    console.error('   and that the token owner has at least viewer access to the consumer file.');
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`❌ Figma API error: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  return res.json();
}

const data = await fetchFigmaVars(CONSUMER_KEY);
const collections = Object.values(data.meta?.variableCollections ?? {});
const variables   = Object.values(data.meta?.variables ?? {});

// ── Classify collections ──────────────────────────────────────────────────────
// remote: false → local override collection (consumer's brand tokens)
// remote: true  → linked DS library collection
//
// ⚠️ NEVER infer library linkage from page structure or component names.
//    The `remote` flag here is the ONLY authoritative signal.

const localCollections  = collections.filter(c => !c.remote);
const remoteCollections = collections.filter(c => c.remote);

console.log('── Variable collections ─────────────────────────────────────────');
for (const c of localCollections)  console.log(`  📁 LOCAL    ${c.name}  (${c.variableIds?.length ?? 0} vars)`);
for (const c of remoteCollections) console.log(`  🔗 LIBRARY  ${c.name}  (${c.variableIds?.length ?? 0} vars)`);

if (remoteCollections.length === 0) {
  console.log('\n⚠️  No linked library collections found in this consumer file.');
  console.log('   The file may not have an external DS library attached,');
  console.log('   or the FIGMA_TOKEN account may not have access to the linked library.');
  console.log('   Check Figma → Assets panel → Libraries to confirm.');
}

// Find the DS library collection by name
const dsLibCollection = remoteCollections.find(c => c.name === COLOR_COLLECTION)
  ?? remoteCollections[0]; // fallback to first remote collection

if (dsLibCollection) {
  console.log(`\n✅ DS library collection identified: "${dsLibCollection.name}"`);
} else {
  console.log(`\n⚠️  Could not identify DS library collection named "${COLOR_COLLECTION}".`);
  console.log('   Update ds-config.json → figma.colorCollection if the name differs.');
}

// ── Build consumer local token map ───────────────────────────────────────────
const localVarIds = new Set(
  localCollections.flatMap(c => c.variableIds ?? [])
);
const consumerLocalTokens = new Set(
  variables
    .filter(v => localVarIds.has(v.id) && !v.name.startsWith(PRIM_PFX))
    .map(v => v.name)
);

console.log(`\n📋 Consumer local tokens: ${consumerLocalTokens.size}`);

// ── Coverage diff ─────────────────────────────────────────────────────────────
// DS tokens not present in consumer's local collection = coverage gaps
const missing   = [];   // DS token with no local override in consumer
const overridden = [];  // DS token has a local override in consumer

for (const token of dsTokens) {
  if (consumerLocalTokens.has(token)) {
    overridden.push(token);
  } else {
    missing.push(token);
  }
}

// Group missing by component prefix (first path segment after any namespace)
function componentPrefix(token) {
  const parts = token.split('/');
  // Skip common non-component prefixes
  if (parts[0] === 'primitives') return 'primitives';
  return parts.slice(0, 2).join('/');
}

const missingByComponent = {};
for (const token of missing) {
  const prefix = componentPrefix(token);
  if (!missingByComponent[prefix]) missingByComponent[prefix] = [];
  missingByComponent[prefix].push(token);
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════');
console.log('  Consumer Audit Report');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`  DS tokens:           ${dsTokens.size}`);
console.log(`  Consumer overrides:  ${overridden.length}  ✅`);
console.log(`  Missing (gap):       ${missing.length}     ❌`);
console.log('══════════════════════════════════════════════════════════════════\n');

if (missing.length === 0) {
  console.log('✅ Consumer file has a local override for every DS token. No coverage gaps.\n');
} else {
  console.log(`❌ ${missing.length} DS tokens have no local override in the consumer file.\n`);
  console.log('── Missing by component ─────────────────────────────────────────');
  const sortedComponents = Object.entries(missingByComponent)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [prefix, tokens] of sortedComponents) {
    console.log(`\n  ${prefix}  (${tokens.length} missing)`);
    for (const t of tokens.slice(0, 10)) console.log(`    ❌ ${t}`);
    if (tokens.length > 10) console.log(`    … and ${tokens.length - 10} more`);
  }
  console.log('\n── Action ───────────────────────────────────────────────────────');
  console.log('  Each missing token is a DS token the consumer file has not adopted.');
  console.log('  Options:');
  console.log('  A. Add the missing token to the consumer\'s local collection with a brand value.');
  console.log('  B. If the DS default value is acceptable, no local override is needed');
  console.log('     (the component will inherit the DS library value directly).');
  console.log('  C. Tokens in components the consumer doesn\'t use → can be ignored.\n');
}

// ── Write report JSON ─────────────────────────────────────────────────────────
const report = {
  _generated: new Date().toISOString().slice(0, 10),
  consumerFileKey: CONSUMER_KEY,
  dsTokenCount: dsTokens.size,
  overriddenCount: overridden.length,
  missingCount: missing.length,
  missingByComponent: Object.fromEntries(
    Object.entries(missingByComponent).map(([k, v]) => [k, v])
  ),
  missingTokens: missing,
  overriddenTokens: overridden,
};
writeFileSync(join(ROOT, 'consumer-audit-report.json'), JSON.stringify(report, null, 2));
console.log('📄 Full report written to consumer-audit-report.json\n');
