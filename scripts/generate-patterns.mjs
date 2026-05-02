#!/usr/bin/env node
/**
 * Abyss Block — توليد ملفات JSON للأنماط للتحقق اليدوي
 *
 * يولّد مثالاً واحداً لكل نمط ويحفظه في patterns/
 * ويشمل الحل والـ pathStates لمراجعة سلامة النمط.
 *
 * الاستخدام:
 *   node scripts/generate-patterns.mjs
 *   BASE_SEED=42 node scripts/generate-patterns.mjs
 */

import fs   from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLevel,
  simulateLevel,
  pruneUnreachableTiles,
  optimizeSolution,
  makeRNG,
} from "../abyss-engine.mjs";
import { PATTERNS, applyPatterns } from "./puzzle-patterns.mjs";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

function hashSeed(base, slot) {
  let x = ((base >>> 0) ^ (slot * 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x ^= x >>> 15;
  return x >>> 0;
}

// Minimal level args that produce good horizontal paths (needed for FRAGILE_BRIDGE)
function makeArgs(seed, overrides = {}) {
  return {
    seed,
    start:       { x: 0, z: 0, orientation: 'V' },
    minMoves:    10,
    maxMoves:    20,
    fragile:     false,
    crumbling:   false,
    moving:      false,
    fragileRate: 0,
    crumblingRate: 0,
    movingCount: 0,
    constraintMode: false,
    expansionOpts: {
      dirAngleDeg:    20,
      spreadDeg:      180,
      deviationPct:   0.25,
      crossAxisLimit: 3,
    },
    ...overrides,
  };
}

// Build a clean level (prune + optimize) and return it with _internal intact
// filter(lvl) optional — skips levels that don't satisfy the pattern's structural requirements
function buildClean(args, filter = null) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const seed = hashSeed(args.seed, attempt);
    const lvl  = buildLevel({ ...args, seed });
    const sim1 = simulateLevel(lvl);
    if (!sim1.ok) continue;
    const pruned  = pruneUnreachableTiles(lvl);
    const optim   = optimizeSolution(pruned);
    const sim2    = simulateLevel(optim);
    if (!sim2.ok) continue;
    if (!optim._internal?.pathStates?.length) continue;
    if (filter && !filter(optim)) continue;
    return optim;
  }
  return null;
}

const PATTERN_CONFIGS = [
  {
    name: 'FRAGILE_BRIDGE',
    description: 'Normal → Fragile → Normal: يجب عبورها أفقياً',
    args: makeArgs(1001),
  },
  {
    name: 'ONE_TIME_PATH',
    description: 'Normal → Crumbling → Normal: لا رجعة',
    args: makeArgs(2002),
  },
  {
    name: 'PRECISION_CORRIDOR',
    description: 'ممر من 3+ بلاطات أفقية متتالية → كلها fragile',
    args: makeArgs(3003, { minMoves: 18, maxMoves: 35 }),
    filter(lvl) {
      const ps = lvl._internal.pathStates;
      for (let i = 1; i < ps.length - 3; i++) {
        let run = 0;
        for (let j = i; j < ps.length - 1; j++) {
          if (ps[j].o === 'HX' || ps[j].o === 'HZ') run++; else break;
        }
        if (run >= 3) return true;
      }
      return false;
    },
  },
  {
    name: 'ALIGNMENT_APPROACH',
    description: 'ضمان منطقة آمنة قبل البلاطة الهشة',
    args: makeArgs(1001), // needs FRAGILE_BRIDGE applied first
    depends: 'FRAGILE_BRIDGE',
  },
];

async function main() {
  const baseSeed = process.env.BASE_SEED !== undefined
    ? Number(process.env.BASE_SEED)
    : 0x4ab955;

  const outDir = path.resolve(PROJECT_ROOT, "patterns");
  await fs.mkdir(outDir, { recursive: true });

  console.log(`\nAbyss Block — توليد أنماط الألغاز للتحقق`);
  console.log(`BASE_SEED=${baseSeed}  →  ${outDir}/\n`);

  const results = [];

  for (const cfg of PATTERN_CONFIGS) {
    const patternDef = PATTERNS[cfg.name];
    if (!patternDef) {
      console.log(`  ✗ نمط غير موجود: ${cfg.name}`);
      continue;
    }

    // Build base level (with optional structural filter for the pattern)
    const base = buildClean({ ...cfg.args, seed: hashSeed(baseSeed, cfg.args.seed) }, cfg.filter ?? null);
    if (!base) {
      console.log(`  ✗ ${cfg.name}: فشل توليد المستوى الأساسي`);
      continue;
    }

    // For ALIGNMENT_APPROACH, apply FRAGILE_BRIDGE first
    let priorLevel = base;
    if (cfg.depends) {
      const depRng = makeRNG(hashSeed(baseSeed ^ 0xdead, cfg.args.seed));
      const withDep = applyPatterns(base, [cfg.depends], depRng);
      if (simulateLevel(withDep).ok) priorLevel = withDep;
    }

    // Apply the target pattern
    const patRng   = makeRNG(hashSeed(baseSeed ^ 0xbeef, cfg.args.seed));
    const withPat  = applyPatterns(priorLevel, [cfg.name], patRng);
    const simAfter = simulateLevel(withPat);

    const appliedList = withPat._internal?.appliedPatterns ?? [];
    const didApply    = appliedList.some(p => p.pattern === cfg.name);

    // Snapshot tile types BEFORE apply (priorLevel is the baseline)
    const before = new Map(priorLevel.tiles.map(t => [`${t.x},${t.z}`, t.type]));
    const after  = new Map(withPat.tiles.map(t => [`${t.x},${t.z}`, t.type]));
    const changes = [];
    for (const [k, typeAfter] of after) {
      const typeBefore = before.get(k);
      if (typeBefore !== typeAfter) changes.push({ cell: k, from: typeBefore, to: typeAfter });
    }

    const { _internal, ...cleanLevel } = withPat;

    const output = {
      pattern: cfg.name,
      description: cfg.description,
      applied: didApply,
      valid_after_apply: simAfter.ok,
      tiles_changed: changes,
      applied_at_index: appliedList.find(p => p.pattern === cfg.name)?.index ?? null,
      path_length: base._internal?.pathStates?.length ?? 0,
      solution_steps: cleanLevel.solution_data?.length ?? 0,
      level: cleanLevel,
    };

    const filename = `pattern_${cfg.name.toLowerCase()}.json`;
    const filepath = path.join(outDir, filename);
    await fs.writeFile(filepath, JSON.stringify(output, null, 2));

    const statusIcon = didApply && simAfter.ok ? '✓' : didApply && !simAfter.ok ? '⚠ invalid after apply' : '✗ لم يُطبَّق';
    console.log(`  ${statusIcon}  ${cfg.name}  changes=${changes.length}  →  ${filename}`);
    results.push({ name: cfg.name, applied: didApply, valid: simAfter.ok, changes: changes.length });
  }

  // Summary index file
  const indexPath = path.join(outDir, "index.json");
  await fs.writeFile(indexPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    base_seed: baseSeed,
    patterns: results,
  }, null, 2));

  console.log(`\nindex.json كُتب في ${outDir}/index.json`);
  const allOk = results.every(r => r.applied && r.valid);
  console.log(allOk ? '\n✅ كل الأنماط سليمة\n' : '\n⚠ بعض الأنماط تحتاج مراجعة\n');
}

main().catch(e => { console.error(e); process.exit(1); });
