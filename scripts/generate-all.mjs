#!/usr/bin/env node
/**
 * Abyss Block — توليد مراحل مُتحقَّق منها
 *
 * الانتخاب الموجَّه بالهدف (Target-Guided Evolution):
 *   كل مرحلة لها صعوبة مستهدفة محسوبة من DIFF_MIN → DIFF_MAX.
 *   الانتخاب يُرجِّح المرشح الأقرب للهدف مع الحفاظ على puzzle_efficiency.
 *
 * متغيرات البيئة:
 *   LEVEL_COUNT  — عدد المراحل (افتراضي: 20، مدى: 5–100)
 *   DIFF_MIN     — صعوبة المرحلة الأولى (افتراضي: 3.5)
 *   DIFF_MAX     — صعوبة المرحلة الأخيرة (افتراضي: 9.5)
 *   DIFF_SIGMA   — تسامح مطابقة الهدف (افتراضي: 1.2، أصغر = أصرم)
 *   EVOLUTION_N  — عدد المرشحين لكل مرحلة (افتراضي: 20)
 *   BASE_SEED    — البذرة الأساسية (عشوائية إن لم تُحدَّد)
 *   DIR_DEG      — اتجاه المسار (افتراضي: 20)
 *   CROSS_WIDTH  — نصف عرض الممر (افتراضي: 3)
 *   LEVELS_OUT   — مجلد الإخراج (افتراضي: levels/)
 */

import fs   from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLevelVerified,
  simulateLevel,
  pruneUnreachableTiles,
  optimizeSolution,
  computeCriticalTiles,
  computeBehavioralMetrics,
  computeEvolutionFitness,
  tileStats,
  makeRNG,
} from "../abyss-engine.mjs";
import { applyPatterns } from "./puzzle-patterns.mjs";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ── helpers ──────────────────────────────────────────────────────────
function lerp(a, b, t)      { return a + (b - a) * t; }
function lerpRound(a, b, t) { return Math.round(lerp(a, b, t)); }
function phaseT(i, n)       { return n <= 1 ? 1 : i / (n - 1); }
function evenGrid(n)        { return n % 2 === 0 ? n : n - 1; }

function hashSeed(base, slot) {
  let x = ((base >>> 0) ^ (slot * 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x ^= x >>> 15;
  return x >>> 0;
}

// ── توزيع المراحل حسب الأوزان ───────────────────────────────────────
// يُعيد مصفوفة أعداد صحيحة تجمع إلى total،
// كل عنصر ≥ 1 إذا كان الوزن > 0 وكان total يكفي.
function distributeWeighted(total, weights) {
  const sum   = weights.reduce((a, b) => a + b, 0);
  const raw   = weights.map(w => (w / sum) * total);
  const counts = raw.map(Math.floor);
  let rem = total - counts.reduce((a, b) => a + b, 0);

  // وزّع البقية على الأجزاء ذات الكسر الأكبر
  raw.map((r, i) => ({ i, f: r - Math.floor(r) }))
     .sort((a, b) => b.f - a.f)
     .slice(0, rem)
     .forEach(({ i }) => counts[i]++);

  // ضمان حدٍّ أدنى 1 لكل مرحلة قدر الإمكان
  const active = Math.min(weights.length, total);
  for (let i = 0; i < active; i++) {
    if (counts[i] === 0) {
      const maxIdx = counts.reduce((mi, c, ci) => c > counts[mi] ? ci : mi, 0);
      if (counts[maxIdx] > 1) { counts[maxIdx]--; counts[i]++; }
    }
  }
  return counts;
}

// ── تصحيح حدود الخريطة ───────────────────────────────────────────────
// يشمل كامل نطاق تذبذب moving tiles حتى لا تظهر خارج الـ grid.
function recomputeMapBounds(data) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of data.tiles) {
    if (t.type === 'moving' && t.params) {
      const { axis, range } = t.params;
      if (axis === 'x') {
        minX = Math.min(minX, range[0]); maxX = Math.max(maxX, range[1]);
        minZ = Math.min(minZ, t.z);      maxZ = Math.max(maxZ, t.z);
      } else {
        minX = Math.min(minX, t.x);      maxX = Math.max(maxX, t.x);
        minZ = Math.min(minZ, range[0]); maxZ = Math.max(maxZ, range[1]);
      }
    } else {
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minZ = Math.min(minZ, t.z); maxZ = Math.max(maxZ, t.z);
    }
  }
  if (!isFinite(minX)) return data.level_metadata?.map_bounds ?? null;
  return { minX, maxX, minZ, maxZ, width: maxX - minX + 1, length: maxZ - minZ + 1 };
}

// ── معادلة الانتخاب الموجَّه بالهدف ──────────────────────────────────
// تجمع بين puzzle_efficiency (جودة اللغز) وقرب الصعوبة من الهدف.
//
//   proximity = exp(-(score - target)² / (2 × sigma²))
//   selection = fitness × (FLOOR + (1 - FLOOR) × proximity)
//
// FLOOR = 0.25 → حتى لو لا يوجد مرشح قريب، نختار الأفضل fitness.
// FLOOR = 0    → نرفض أي مرشح بعيد عن الهدف تماماً.
const SELECTION_FLOOR = 0.25;

function selectionScore(fitness, computedDifficulty, targetDifficulty, sigma) {
  const d         = computedDifficulty - targetDifficulty;
  const proximity = Math.exp(-(d * d) / (2 * sigma * sigma));
  return fitness * (SELECTION_FLOOR + (1 - SELECTION_FLOOR) * proximity);
}

// ── قوالب المراحل ─────────────────────────────────────────────────────
// كل قالب يصف ميكانيكيات مرحلة. الدالة fn() تُنتج إعدادات بناءً على
// موضع المرحلة (phaseT) وعدد مراحلها الفعلي (count).
// يُبنى PHASES ديناميكياً من هذه القوالب حسب LEVEL_COUNT.

const PHASE_TEMPLATES = [

  // ── Hard Start ──────────────────────────────────────────────────
  {
    label: 'hard_start', weight: 25,
    constraints: { minMoves: 20, maxMoves: 50, minBFSMoves: 12 },
    maxAttempts: 40,
    fn(i, count, seed, dirDeg, crossW) {
      const ti = phaseT(i, count);
      return {
        seed,
        difficulty:  lerpRound(4, 6, ti),
        gridSize:    evenGrid(lerpRound(16, 22, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: false, portal: false,
          fragileRate:    +lerp(0.42, 0.55, ti).toFixed(3),
          crumblingRate:  +lerp(0.18, 0.30, ti).toFixed(3),
          constraintMode: true,
        },
        patterns:  ['FRAGILE_BRIDGE', 'ONE_TIME_PATH'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      90,
          deviationPct:   0.18,
          crossAxisLimit: Math.max(2, crossW - 1),
        },
      };
    },
  },

  // ── Precision ───────────────────────────────────────────────────
  {
    label: 'precision', weight: 25,
    constraints: { minMoves: 28, maxMoves: 58, minBFSMoves: 16 },
    maxAttempts: 45,
    fn(i, count, seed, dirDeg, crossW) {
      const ti = phaseT(i, count);
      return {
        seed,
        difficulty:  lerpRound(5, 7, ti),
        gridSize:    evenGrid(lerpRound(20, 28, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: false, portal: false,
          fragileRate:    +lerp(0.48, 0.58, ti).toFixed(3),
          crumblingRate:  +lerp(0.25, 0.38, ti).toFixed(3),
          constraintMode: true,
        },
        patterns:  ['FRAGILE_BRIDGE', 'ONE_TIME_PATH', 'PRECISION_CORRIDOR'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      80,
          deviationPct:   0.12,
          crossAxisLimit: Math.max(2, crossW - 1),
        },
      };
    },
  },

  // ── Moving ──────────────────────────────────────────────────────
  {
    label: 'moving', weight: 25,
    constraints: { minMoves: 38, maxMoves: 68, minBFSMoves: 22 },
    maxAttempts: 160,
    fn(i, count, seed, dirDeg, crossW) {
      const ti = phaseT(i, count);
      return {
        seed,
        difficulty:  lerpRound(6, 9, ti),
        gridSize:    evenGrid(lerpRound(26, 34, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: true, portal: false,
          fragileRate:    0.48,
          crumblingRate:  0.30,
          constraintMode: true,
        },
        patterns:  ['FRAGILE_BRIDGE', 'ONE_TIME_PATH', 'PRECISION_CORRIDOR'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      95,
          deviationPct:   0.20,
          crossAxisLimit: crossW,
        },
      };
    },
  },

  // ── Islands ─────────────────────────────────────────────────────
  {
    label: 'islands', weight: 15,
    constraints: { minMoves: 30, maxMoves: 68, minBFSMoves: 24 },
    maxAttempts: 35,
    fn(i, count, seed, dirDeg, crossW) {
      const ti = phaseT(i, count);
      return {
        seed,
        difficulty:  lerpRound(7, 9, ti),
        gridSize:    evenGrid(lerpRound(28, 36, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: false, portal: true,
          fragileRate:    +lerp(0.30, 0.42, ti).toFixed(3),
          crumblingRate:  +lerp(0.12, 0.22, ti).toFixed(3),
          constraintMode: true,
        },
        patterns:  ['FRAGILE_BRIDGE', 'ONE_TIME_PATH'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      70,
          deviationPct:   0.15,
          crossAxisLimit: crossW,
        },
      };
    },
  },

  // ── ABYSS ───────────────────────────────────────────────────────
  {
    label: 'abyss', weight: 10,
    constraints: { minMoves: 45, maxMoves: 85, minBFSMoves: 30 },
    maxAttempts: 32,
    fn(i, count, seed, dirDeg, crossW) {
      const ti = phaseT(i, count);
      return {
        seed,
        difficulty:  lerpRound(9, 10, ti),
        gridSize:    evenGrid(lerpRound(34, 40, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: true, portal: true,
          fragileRate:    0.52,
          crumblingRate:  0.36,
          constraintMode: true,
        },
        patterns:  ['FRAGILE_BRIDGE', 'ONE_TIME_PATH', 'PRECISION_CORRIDOR'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      115,
          deviationPct:   0.25,
          crossAxisLimit: crossW + 2,
        },
      };
    },
  },
];

// ── بناء PHASES ديناميكياً من LEVEL_COUNT ─────────────────────────────
function buildPhases(levelCount) {
  const weights = PHASE_TEMPLATES.map(t => t.weight);
  const counts  = distributeWeighted(levelCount, weights);

  let fromSlot = 1;
  return PHASE_TEMPLATES
    .map((tmpl, i) => {
      const count = counts[i];
      const from  = fromSlot;
      fromSlot   += count;
      return { ...tmpl, from, count };
    })
    .filter(p => p.count > 0);
}

// ── حساب الصعوبات المستهدفة ───────────────────────────────────────────
// تسلسل خطي تصاعدي صارم من diffMin إلى diffMax على levelCount مرحلة.
function computeTargets(levelCount, diffMin, diffMax) {
  return Array.from({ length: levelCount }, (_, i) =>
    +lerp(diffMin, diffMax, levelCount <= 1 ? 1 : i / (levelCount - 1)).toFixed(3)
  );
}

// ── التحقق المزدوج ────────────────────────────────────────────────────
function doubleCheck(clean) {
  const required = ['level_metadata', 'start_state', 'hole_pos', 'tiles', 'solution_data'];
  for (const k of required) {
    if (!(k in clean)) return { ok: false, reason: `missing field: ${k}` };
  }
  if (!Array.isArray(clean.tiles) || clean.tiles.length === 0)
    return { ok: false, reason: 'empty tiles array' };
  if (!Array.isArray(clean.solution_data) || clean.solution_data.length === 0)
    return { ok: false, reason: 'empty solution_data' };

  const sim = simulateLevel(clean);
  if (!sim.ok) return { ok: false, reason: `sim fail step=${sim.step} ${sim.reason}` };

  // تحقق من عدم وجود بلاطات ثابتة خارج الحدود المُعلنة
  const mb = clean.level_metadata?.map_bounds;
  if (mb) {
    for (const t of clean.tiles) {
      if (t.type === 'moving') continue;
      if (t.x < mb.minX || t.x > mb.maxX || t.z < mb.minZ || t.z > mb.maxZ)
        return { ok: false, reason: `tile (${t.x},${t.z}) outside map_bounds` };
    }
  }
  return { ok: true };
}

// ── خط أنابيب مرشح واحد ──────────────────────────────────────────────
const PAT_XOR = 0xbeef_cafe;

function buildScoredCandidate(slot, evoSeed, phase, phaseIdx, dirDeg, crossW) {
  const args = phase.fn(phaseIdx, phase.count, evoSeed, dirDeg, crossW);
  const { lvl, attempts, verified } = buildLevelVerified(
    args, phase.constraints, phase.maxAttempts
  );
  if (!lvl) return null;

  // للـ fallback: طبّق BFS يدوياً وتحقق من minBFSMoves
  let workLvl = lvl;
  if (!verified) {
    const pruned = pruneUnreachableTiles(lvl);
    const bfs    = optimizeSolution(pruned);
    if (!simulateLevel(bfs).ok) return null;
    if (bfs.solution_data.length < (phase.constraints.minBFSMoves ?? 0)) return null;
    workLvl = bfs;
  }

  // طبّق الأنماط
  let finalLvl = workLvl;
  const patternsToApply = args.patterns ?? [];
  if (patternsToApply.length > 0 && workLvl._internal?.pathStates) {
    const patRng = makeRNG(hashSeed(PAT_XOR ^ evoSeed, slot));
    const candidate = applyPatterns(workLvl, patternsToApply, patRng);
    if (simulateLevel(candidate).ok) finalLvl = candidate;
  }

  const { _internal, ...optimized } = finalLvl;

  // صحّح الحدود لتشمل نطاق moving tiles
  const correctedBounds = recomputeMapBounds(optimized);
  if (correctedBounds) {
    optimized.level_metadata = { ...optimized.level_metadata, map_bounds: correctedBounds };
  }

  const movesAfterOpt = optimized.solution_data.length;
  const stats         = tileStats(optimized);
  const criticalTiles = computeCriticalTiles(optimized);
  const metrics       = computeBehavioralMetrics(optimized, criticalTiles);
  const score         = metrics.behavioral_difficulty;
  const fitness       = computeEvolutionFitness(optimized, criticalTiles, metrics);

  return {
    finalLvl, _internal, optimized, args,
    metrics, stats, criticalTiles,
    attempts, verified, score, fitness, movesAfterOpt,
  };
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {

  // ─ قراءة المتغيرات ─────────────────────────────────────────────────
  const baseSeed = process.env.BASE_SEED !== undefined && process.env.BASE_SEED !== ""
    ? Number(process.env.BASE_SEED)
    : Math.floor(Math.random() * 0xFFFF_FFFF);
  if (!Number.isFinite(baseSeed)) { console.error("BASE_SEED must be a number"); process.exit(1); }

  const dirDeg = process.env.DIR_DEG !== undefined ? Number(process.env.DIR_DEG) : 20;
  if (!Number.isFinite(dirDeg)) { console.error("DIR_DEG must be a number"); process.exit(1); }

  const crossW = process.env.CROSS_WIDTH !== undefined ? Number(process.env.CROSS_WIDTH) : 3;
  if (!Number.isFinite(crossW) || crossW < 0) { console.error("CROSS_WIDTH must be ≥ 0"); process.exit(1); }

  const evolutionN = process.env.EVOLUTION_N !== undefined
    ? Math.max(1, Math.round(Number(process.env.EVOLUTION_N)))
    : 20;
  if (!Number.isFinite(evolutionN)) { console.error("EVOLUTION_N must be a number"); process.exit(1); }

  const levelCount = process.env.LEVEL_COUNT !== undefined
    ? Math.max(5, Math.round(Number(process.env.LEVEL_COUNT)))
    : 20;
  if (!Number.isFinite(levelCount)) { console.error("LEVEL_COUNT must be a number"); process.exit(1); }

  const diffMin = process.env.DIFF_MIN !== undefined ? Number(process.env.DIFF_MIN) : 3.5;
  const diffMax = process.env.DIFF_MAX !== undefined ? Number(process.env.DIFF_MAX) : 9.5;
  if (!Number.isFinite(diffMin) || !Number.isFinite(diffMax) || diffMin >= diffMax)
    { console.error("DIFF_MIN must be < DIFF_MAX"); process.exit(1); }

  const diffSigma = process.env.DIFF_SIGMA !== undefined ? Number(process.env.DIFF_SIGMA) : 1.2;
  if (!Number.isFinite(diffSigma) || diffSigma <= 0) { console.error("DIFF_SIGMA must be > 0"); process.exit(1); }

  const outDir = path.resolve(PROJECT_ROOT, process.env.LEVELS_OUT ?? "levels");
  await fs.mkdir(outDir, { recursive: true });

  // ─ بناء المراحل والأهداف ───────────────────────────────────────────
  const PHASES  = buildPhases(levelCount);
  const targets = computeTargets(levelCount, diffMin, diffMax);

  // ─ رأس التقرير ─────────────────────────────────────────────────────
  const dirLabel = dirDeg === 0 ? "east" : dirDeg > 0 ? `east+${dirDeg}°S` : `east${dirDeg}°N`;
  console.log(`\nAbyss Block — توليد ${levelCount} مرحلة مُتحقَّق منها`);
  console.log([
    `BASE_SEED=${baseSeed}`,
    `DIR_DEG=${dirDeg} (${dirLabel})`,
    `CROSS_WIDTH=${crossW}`,
    `EVOLUTION_N=${evolutionN}`,
    `LEVEL_COUNT=${levelCount}`,
    `DIFF=${diffMin}→${diffMax}`,
    `SIGMA=${diffSigma}`,
    `→ ${outDir}/`,
  ].join('  ') + '\n');

  // تفصيل الأهداف لكل مرحلة
  console.log("── Difficulty targets");
  for (const ph of PHASES) {
    const slotTargets = Array.from({ length: ph.count }, (_, i) => targets[ph.from - 1 + i]);
    console.log(`   ${ph.label.padEnd(12)} slots ${ph.from}–${ph.from + ph.count - 1}  targets: ${slotTargets.join(', ')}`);
  }
  console.log();

  // ─ حلقة التوليد الرئيسية ──────────────────────────────────────────
  let totalOk = 0, totalFallback = 0;
  const difficultyLog = [];

  for (const phase of PHASES) {
    const end = phase.from + phase.count - 1;
    console.log(`── ${phase.label.toUpperCase()} (${phase.from}–${end})`);

    for (let i = 0; i < phase.count; i++) {
      const slot   = phase.from + i;
      const target = targets[slot - 1];

      // ── الانتخاب الموجَّه بالهدف ──────────────────────────────────
      // ei=0 يستخدم البذرة الكلاسيكية → EVOLUTION_N=1 = سلوك قديم تاماً.
      let bestResult      = null;
      let bestSelScore    = -Infinity;
      let firstScore      = null;
      let firstFitness    = null;

      for (let ei = 0; ei < evolutionN; ei++) {
        const evoSeed = ei === 0
          ? hashSeed(baseSeed, slot)
          : hashSeed(baseSeed ^ (ei * 0x9e3779b1), slot);

        const result = buildScoredCandidate(slot, evoSeed, phase, i, dirDeg, crossW);
        if (!result) continue;

        if (firstScore   === null) firstScore   = result.score;
        if (firstFitness === null) firstFitness = result.fitness;

        const sel = selectionScore(result.fitness, result.score, target, diffSigma);

        if (sel > bestSelScore) {
          bestSelScore = sel;
          bestResult   = { ...result, evoSeed, evoIdx: ei, selScore: sel };
        }
      }

      if (!bestResult) {
        console.error(`  ✗ ${slot} all ${evolutionN} candidates failed`);
        totalFallback++;
        continue;
      }

      const {
        finalLvl, _internal, optimized, args,
        metrics, stats, criticalTiles,
        attempts, verified, score, fitness, movesAfterOpt,
        evoSeed, evoIdx,
      } = bestResult;

      const delta      = +(score - target).toFixed(2);
      const deltaStr   = delta >= 0 ? `+${delta}` : `${delta}`;
      const fitnessGain = firstFitness !== null ? +(fitness - firstFitness).toFixed(3) : 0;

      // ─ ختم الـ metadata ──────────────────────────────────────────
      optimized.level_metadata = {
        ...optimized.level_metadata,
        id:               `lvl_${slot}`,
        slot,
        phase:            phase.label,
        difficulty:       args.difficulty,
        target_difficulty: target,
        mechanics:        args.mechanics,
        generator: {
          base_seed:      baseSeed,
          attempts,
          verified,
          dir_angle_deg:  args.expansionOpts.dirAngleDeg ?? 0,
          spreadDeg:      args.expansionOpts.spreadDeg   ?? 360,
          deviationPct:   args.expansionOpts.deviationPct ?? 0,
          crossAxisLimit: args.expansionOpts.crossAxisLimit ?? 0,
        },
        evolution: {
          n_candidates:      evolutionN,
          winner_index:      evoIdx,
          winner_seed:       evoSeed,
          selection_score:   +bestSelScore.toFixed(4),
          fitness_first:     firstFitness,
          fitness_best:      fitness,
          fitness_gain:      fitnessGain,
          score_first:       firstScore,
          score_best:        score,
          target_difficulty: target,
          delta_from_target: delta,
        },
        steps_to_solve:      movesAfterOpt,
        tile_stats:          stats,
        computed_difficulty: score,
        behavioral_analysis: {
          precision_moves:       metrics.precision_moves,
          crumbling_moves:       metrics.crumbling_moves,
          orientation_changes:   metrics.orientation_changes,
          portal_traversals:     metrics.portal_traversals,
          critical_tile_count:   criticalTiles.size,
          critical_hazard_count: metrics.critical_hazard_count,
          behavioral_difficulty: score,
          puzzle_efficiency:     fitness,
        },
        applied_patterns: finalLvl._internal?.appliedPatterns ?? [],
      };

      difficultyLog.push({
        slot, computed: score, target,
        delta, label: phase.label,
        fitness, fitnessGain,
      });

      // ─ تحقق مزدوج قبل الكتابة ────────────────────────────────────
      const dc = doubleCheck(optimized);
      if (!dc.ok) {
        console.error(`  ✗ ${slot} double-check FAIL: ${dc.reason}`);
        totalFallback++;
      } else {
        totalOk++;
      }

      // ─ طباعة السطر ───────────────────────────────────────────────
      const islandTag   = optimized.level_metadata.island_count
        ? `  isl=${optimized.level_metadata.island_count}` : "";
      const verifyTag   = verified ? "✓" : "⚠";
      const attemptsTag = attempts > 1 ? ` (${attempts})` : "";
      const mb          = optimized.level_metadata.map_bounds;
      const mapTag      = mb ? `  ${mb.width}×${mb.length}` : "";
      const trapTag     = `  ${stats.fragile}f/${stats.crumbling}c/${stats.moving}m`;
      const evoTag      = evolutionN > 1
        ? `  evo=${evoIdx + 1}/${evolutionN}`
        : "";

      console.log(
        `  ${verifyTag} ${String(slot).padStart(2)}`
        + `  tgt=${String(target).padEnd(4)}`
        + `  got=${String(score).padStart(5)}`
        + `  Δ=${deltaStr.padStart(5)}`
        + `  fit=${fitness}`
        + `  mv=${movesAfterOpt}`
        + `  ti=${optimized.tiles.length}`
        + mapTag
        + trapTag
        + islandTag
        + evoTag
        + attemptsTag
      );

      await fs.writeFile(
        path.join(outDir, `${slot}.json`),
        JSON.stringify(optimized, null, 2),
        "utf8"
      );
    }
    console.log();
  }

  // ─ تقرير الصعوبة ──────────────────────────────────────────────────
  console.log(`تم — ${totalOk}/${levelCount} مرحلة معتمدة`
    + (totalFallback ? ` ⚠ ${totalFallback} مشكلة` : " ✓ جميعها صحيحة"));

  console.log("\n── Difficulty report  (target → actual  Δ)");
  let prevScore = -Infinity, orderOk = true, totalDelta = 0;

  for (const { slot, computed, target, delta, label } of difficultyLog) {
    const arrow     = computed >= prevScore ? "▲" : "▼";
    const outOrder  = computed < prevScore;
    if (outOrder) orderOk = false;
    totalDelta += Math.abs(delta);

    const bar  = "█".repeat(Math.round(computed))
               + "░".repeat(Math.max(0, 10 - Math.round(computed)));
    const warn = outOrder ? " ⚠ OUT OF ORDER" : "";
    console.log(
      `  ${arrow} ${String(slot).padStart(2)}  [${label.padEnd(10)}]`
      + `  tgt=${String(target).padEnd(4)}`
      + `  got=${String(computed).padStart(5)}`
      + `  Δ=${String(delta >= 0 ? '+'+delta : delta).padStart(5)}`
      + `  ${bar}${warn}`
    );
    prevScore = computed;
  }

  const avgDelta = (totalDelta / levelCount).toFixed(3);
  console.log(orderOk
    ? `\n  ✓ ترتيب الصعوبة صحيح تماماً  (متوسط |Δ| = ${avgDelta})`
    : `\n  ⚠ بعض المراحل خارج الترتيب  (متوسط |Δ| = ${avgDelta})`
      + `\n  💡 جرّب: زيادة EVOLUTION_N أو تضييق DIFF_SIGMA`
  );

  // ─ تقرير الانتخاب ─────────────────────────────────────────────────
  if (evolutionN > 1) {
    const improved   = difficultyLog.filter(e => e.fitnessGain > 0).length;
    const avgFitGain = (difficultyLog.reduce((s, e) => s + e.fitnessGain, 0) / levelCount).toFixed(3);
    console.log(`\n── Evolution summary  (N=${evolutionN}  sigma=${diffSigma})`);
    console.log(`  Avg fitness gain  : +${avgFitGain}`);
    console.log(`  Levels improved   : ${improved}/${levelCount}`);
    console.log(`  Avg |Δ| from target: ${avgDelta}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
