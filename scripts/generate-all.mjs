#!/usr/bin/env node
/**
 * Abyss Block — توليد ٢٠ مرحلة مُتحقَّق منها
 *
 * خط الأنابيب لكل مرحلة:
 *   1. توليد N مرشح (Generational Evolution)
 *   2. الاختيار بمعيار: moves↑ / tiles↓ / traps↓ / trap_necessity↑
 *   3. محاكاة كاملة → تحقق مزدوج → كتابة الملف
 *
 * المراحل (٢٠ مرحلة، صعبة من المرحلة الأولى):
 *   1–5   Hard Start   fragile + crumbling، D4→D6
 *   6–10  Precision    fragile + crumbling ثقيل، D5→D7
 *  11–15  Moving       fragile + crumbling + moving، D6→D8
 *  16–18  Islands      جزر + بوابات، D7→D9
 *  19–20  ABYSS        كل الميكانيكيات، D9→D10
 *
 * متغيرات البيئة:
 *   BASE_SEED    — البذرة الأساسية (عشوائية إن لم تُحدَّد)
 *   DIR_DEG      — اتجاه المسار بالدرجات من الشرق (افتراضي: 20)
 *   CROSS_WIDTH  — نصف عرض الممر العرضي (افتراضي: 3)
 *   EVOLUTION_N  — عدد المرشحين لكل مرحلة (افتراضي: 20)
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
  computeDifficultyScore,
  computeCriticalTiles,
  computeBehavioralMetrics,
  computeEvolutionFitness,
  tileStats,
  makeRNG,
} from "../abyss-engine.mjs";
import { applyPatterns } from "./puzzle-patterns.mjs";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ---- helpers -------------------------------------------------------
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

// ---- Map bounds correction -----------------------------------------
// Recomputes map_bounds from actual tile positions, including full
// oscillation range of moving tiles, so no tile ever appears outside
// the declared grid.
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

// ---- Phase definitions ---------------------------------------------
// 20 levels, hard from level 1, gradual ramp to max difficulty.
//
// Design principle:
//   - constraintMode always on → traps placed only on critical cells
//   - Small gridSize relative to steps → denser, longer paths
//   - High fragile/crumbling rates → fewer safe tiles
//   - crossAxisLimit tight → narrow corridors force orientation management

const TOTAL_LEVELS = 20;

const PHASES = [

  // ── 1–5  Hard Start ─────────────────────────────────────────────
  // Mechanics active from level 1: fragile + crumbling.
  // No tutorial grace period — player faces real traps immediately.
  // minBFSMoves ensures the optimal solution stays long after BFS shortcutting.
  {
    label: "hard_start", from: 1, count: 5,
    constraints: { minMoves: 20, maxMoves: 50, minBFSMoves: 12 },
    maxAttempts: 40,
    fn(i, seed, dirDeg, crossW) {
      const ti = phaseT(i, 5);
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

  // ── 6–10  Precision ─────────────────────────────────────────────
  // Heavier fragile + crumbling, longer BFS-optimal paths, tighter corridors.
  {
    label: "precision", from: 6, count: 5,
    constraints: { minMoves: 28, maxMoves: 58, minBFSMoves: 16 },
    maxAttempts: 45,
    fn(i, seed, dirDeg, crossW) {
      const ti = phaseT(i, 5);
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

  // ── 11–15  Moving ───────────────────────────────────────────────
  // Adds timing puzzles (moving tiles) on top of fragile/crumbling.
  {
    label: "moving", from: 11, count: 5,
    constraints: { minMoves: 38, maxMoves: 68, minBFSMoves: 22 },
    maxAttempts: 160,
    fn(i, seed, dirDeg, crossW) {
      const ti = phaseT(i, 5);
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

  // ── 16–18  Islands ──────────────────────────────────────────────
  // Multi-island navigation via portals + fragile/crumbling on each island.
  // buildIslandLevel injects hazards per island using mechanics (minus portal flag),
  // so fragile/crumbling traps work correctly here.
  {
    label: "islands", from: 16, count: 3,
    constraints: { minMoves: 30, maxMoves: 68, minBFSMoves: 24 },
    maxAttempts: 35,
    fn(i, seed, dirDeg, crossW) {
      const ti = phaseT(i, 3);
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
        patterns: ['FRAGILE_BRIDGE', 'ONE_TIME_PATH'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      70,
          deviationPct:   0.15,
          crossAxisLimit: crossW,
        },
      };
    },
  },

  // ── 19–20  ABYSS ────────────────────────────────────────────────
  // All mechanics combined at max difficulty.
  {
    label: "abyss", from: 19, count: 2,
    constraints: { minMoves: 45, maxMoves: 85, minBFSMoves: 30 },
    maxAttempts: 32,
    fn(i, seed, dirDeg, crossW) {
      const ti = phaseT(i, 2);
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

// ---- Double-check: JSON shape + full simulation + bounds -----------
function doubleCheck(clean) {
  const required = ['level_metadata', 'start_state', 'hole_pos', 'tiles', 'solution_data'];
  for (const k of required) {
    if (!(k in clean)) return { ok: false, reason: `missing field: ${k}` };
  }
  if (!Array.isArray(clean.tiles) || clean.tiles.length === 0)
    return { ok: false, reason: 'empty tiles array' };
  if (!Array.isArray(clean.solution_data) || clean.solution_data.length === 0)
    return { ok: false, reason: 'empty solution_data' };

  // Full physics simulation
  const sim = simulateLevel(clean);
  if (!sim.ok) return { ok: false, reason: `sim fail step=${sim.step} ${sim.reason}` };

  // Tile bounds: every static tile must be within declared map_bounds.
  // Moving tiles are covered because recomputeMapBounds already includes their ranges.
  const mb = clean.level_metadata?.map_bounds;
  if (mb) {
    for (const t of clean.tiles) {
      if (t.type === 'moving') continue; // range included in bounds by construction
      if (t.x < mb.minX || t.x > mb.maxX || t.z < mb.minZ || t.z > mb.maxZ)
        return { ok: false, reason: `tile (${t.x},${t.z}) outside map_bounds` };
    }
  }

  return { ok: true };
}

// ---- Single-candidate pipeline -------------------------------------
// Builds, verifies, applies patterns, and scores one candidate level.
// Returns a result object, or null if the build failed entirely.
const PAT_XOR = 0xbeef_cafe;

function buildScoredCandidate(slot, evoSeed, phase, phaseIdx, dirDeg, crossW) {
  const args = phase.fn(phaseIdx, evoSeed, dirDeg, crossW);
  const { lvl, attempts, verified } = buildLevelVerified(args, phase.constraints, phase.maxAttempts);
  if (!lvl) return null;

  // For fallback levels (verified=false), buildLevelVerified returned the raw
  // buildLevel() output without BFS optimization or minBFSMoves enforcement.
  // Apply BFS here and enforce minBFSMoves to reject trivially short fallbacks.
  let workLvl = lvl;
  if (!verified) {
    const pruned = pruneUnreachableTiles(lvl);
    const bfs    = optimizeSolution(pruned);
    if (!simulateLevel(bfs).ok) return null;
    const minBFSMoves = phase.constraints.minBFSMoves ?? 0;
    if (bfs.solution_data.length < minBFSMoves) return null;
    workLvl = bfs;
  }

  // Apply puzzle patterns
  let finalLvl = workLvl;
  const patternsToApply = args.patterns ?? [];
  if (patternsToApply.length > 0 && lvl._internal?.pathStates) {
    const patRng = makeRNG(hashSeed(PAT_XOR ^ evoSeed, slot));
    const candidate = applyPatterns(lvl, patternsToApply, patRng);
    if (simulateLevel(candidate).ok) finalLvl = candidate;
  }

  const { _internal, ...optimized } = finalLvl;

  // Correct map_bounds to include moving tile oscillation range
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

// ---- Main ----------------------------------------------------------
async function main() {
  const baseSeed = process.env.BASE_SEED !== undefined && process.env.BASE_SEED !== ""
    ? Number(process.env.BASE_SEED)
    : Math.floor(Math.random() * 0xFFFF_FFFF);
  if (!Number.isFinite(baseSeed)) { console.error("BASE_SEED must be a number"); process.exit(1); }

  const dirDeg = process.env.DIR_DEG !== undefined ? Number(process.env.DIR_DEG) : 20;
  if (!Number.isFinite(dirDeg)) { console.error("DIR_DEG must be a number"); process.exit(1); }

  const crossW = process.env.CROSS_WIDTH !== undefined ? Number(process.env.CROSS_WIDTH) : 3;
  if (!Number.isFinite(crossW) || crossW < 0) { console.error("CROSS_WIDTH must be a non-negative number"); process.exit(1); }

  const evolutionN = process.env.EVOLUTION_N !== undefined
    ? Math.max(1, Math.round(Number(process.env.EVOLUTION_N)))
    : 20;
  if (!Number.isFinite(evolutionN)) { console.error("EVOLUTION_N must be a number"); process.exit(1); }

  const outDir = path.resolve(PROJECT_ROOT, process.env.LEVELS_OUT ?? "levels");
  await fs.mkdir(outDir, { recursive: true });

  const dirLabel = dirDeg === 0 ? "east" : dirDeg > 0 ? `east+${dirDeg}°S` : `east${dirDeg}°N`;
  console.log(`\nAbyss Block — توليد ${TOTAL_LEVELS} مرحلة مُتحقَّق منها`);
  console.log(`BASE_SEED=${baseSeed}  DIR_DEG=${dirDeg} (${dirLabel})  CROSS_WIDTH=${crossW}  EVOLUTION_N=${evolutionN}  →  ${outDir}/\n`);

  let totalOk = 0, totalFallback = 0;
  const difficultyLog = [];

  for (const phase of PHASES) {
    const end = phase.from + phase.count - 1;
    console.log(`── ${phase.label.toUpperCase()} (${phase.from}–${end})`);

    for (let i = 0; i < phase.count; i++) {
      const slot = phase.from + i;

      // ── Generational Evolution ──────────────────────────────────────
      // Selection criterion: max puzzle_efficiency (few tiles + few traps + many moves
      // + all traps critical). ei=0 uses the canonical seed for determinism at N=1.
      let bestResult   = null;
      let firstFitness = null;

      for (let ei = 0; ei < evolutionN; ei++) {
        const evoSeed = ei === 0
          ? hashSeed(baseSeed, slot)
          : hashSeed(baseSeed ^ (ei * 0x9e3779b1), slot);

        const result = buildScoredCandidate(slot, evoSeed, phase, i, dirDeg, crossW);
        if (!result) continue;

        if (firstFitness === null) firstFitness = result.fitness;

        if (!bestResult || result.fitness > bestResult.fitness) {
          bestResult = { ...result, evoSeed, evoIdx: ei };
        }
      }

      if (!bestResult) {
        console.error(`  ✗ ${slot} all ${evolutionN} evolution candidates failed`);
        totalFallback++;
        continue;
      }

      const {
        finalLvl, _internal, optimized, args,
        metrics, stats, criticalTiles,
        attempts, verified, score, fitness, movesAfterOpt,
        evoSeed, evoIdx,
      } = bestResult;

      // Stamp final metadata
      optimized.level_metadata = {
        ...optimized.level_metadata,
        id:         `lvl_${slot}`,
        slot,
        phase:      phase.label,
        difficulty: args.difficulty,
        mechanics:  args.mechanics,
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
          fitness_first:     firstFitness,
          fitness_best:      fitness,
          fitness_gain:      +(fitness - firstFitness).toFixed(4),
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
        slot, computed: score, fitness, label: phase.label,
        gain: +(fitness - firstFitness).toFixed(4),
      });

      // Double-check before writing
      const dc = doubleCheck(optimized);
      if (!dc.ok) {
        console.error(`  ✗ ${slot} double-check FAIL: ${dc.reason}`);
        totalFallback++;
      } else {
        totalOk++;
      }

      const islandTag   = optimized.level_metadata.island_count
        ? `  islands=${optimized.level_metadata.island_count}` : "";
      const verifyTag   = verified ? "✓" : "⚠ fallback";
      const attemptsTag = attempts > 1 ? ` (${attempts} tries)` : "";
      const trapTag     = `  traps=${stats.fragile}f/${stats.crumbling}c/${stats.moving}m`
                        + `  ρ=${stats.trap_density}`;
      const mb      = optimized.level_metadata.map_bounds;
      const mapTag  = mb ? `  map=${mb.width}×${mb.length}` : "";
      const behavTag = `  prec=${metrics.precision_moves}  crumb=${metrics.crumbling_moves}  crit=${criticalTiles.size}`;
      const evoTag   = evolutionN > 1
        ? `  evo=${evoIdx + 1}/${evolutionN}` + (fitness > firstFitness ? `+${+(fitness - firstFitness).toFixed(2)}` : "")
        : "";

      console.log(
        `  ${verifyTag} ${String(slot).padStart(2)}`
        + `  D${args.difficulty}→${score}`
        + `  fit=${fitness}`
        + `  moves=${movesAfterOpt}`
        + `  tiles=${optimized.tiles.length}`
        + mapTag
        + trapTag
        + behavTag
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

  console.log(`تم — ${totalOk}/${TOTAL_LEVELS} مرحلة معتمدة` + (totalFallback ? ` ⚠ ${totalFallback} fallback` : " ✓ جميعها صحيحة"));

  // ── Difficulty ordering report ──────────────────────────────────────
  console.log("\n── Difficulty ordering (computed_difficulty)");
  let prevScore = 0, orderOk = true;
  for (const { slot, computed, fitness, label } of difficultyLog) {
    const arrow = computed >= prevScore ? "▲" : "▼";
    const warn  = computed < prevScore ? " ⚠ OUT OF ORDER" : "";
    if (computed < prevScore) orderOk = false;
    console.log(`  ${arrow} ${String(slot).padStart(2)}  [${label.padEnd(10)}]  score=${computed}  fit=${fitness}${warn}`);
    prevScore = computed;
  }
  console.log(orderOk
    ? "\n  ✓ All levels increase in computed difficulty"
    : "\n  ⚠ Some levels are out of difficulty order — consider adjusting phase params"
  );

  // ── Evolution improvement summary ──────────────────────────────────
  if (evolutionN > 1) {
    const improved = difficultyLog.filter(e => e.gain > 0);
    const avgGain  = difficultyLog.reduce((s, e) => s + e.gain, 0) / difficultyLog.length;
    console.log(`\n── Evolution summary (N=${evolutionN})`);
    console.log(`  Avg fitness gain : +${avgGain.toFixed(4)}`);
    console.log(`  Levels improved  : ${improved.length}/${TOTAL_LEVELS}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
