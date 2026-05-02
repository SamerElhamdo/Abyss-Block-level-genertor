#!/usr/bin/env node
/**
 * Abyss Block — توليد ٥٠ مرحلة مُتحقَّق منها
 *
 * خط الأنابيب لكل مرحلة:
 *   1. توليد → 2. محاكاة كاملة (fragile/crumbling) → 3. إعادة توليد عند الفشل
 *   → 4. تحقق مزدوج → 5. تنظيف البلاطات غير المستخدمة → 6. كتابة الملف
 *
 * المراحل:
 *   1–10   Tutorial   لا أفخاخ
 *  11–20   Fragile    بلاطات هشة تتصاعد تدريجياً
 *  21–30   Crumbling  هشة + متداعية
 *  31–40   Moving     هشة + متداعية + متحركة
 *  41–45   Islands    جزر منفصلة (بوابات)
 *  46–50   ABYSS      كل المكانيكيات
 *
 * الاستخدام:
 *   node scripts/generate-all.mjs
 *   BASE_SEED=1234 LEVELS_OUT=dist/levels node scripts/generate-all.mjs
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

// ---- Phase definitions ---------------------------------------------
// Each phase has:
//   label, from, count
//   fn(i, seed) → { seed, difficulty, gridSize, mechanics, expansionOpts }
//   constraints: { minMoves, maxMoves }
//   maxAttempts: retry budget

// ---- Phase definitions ---------------------------------------------
// Global direction: all phases share dirAngleDeg + crossAxisLimit from env/defaults.
// Each phase only controls spreadDeg, deviationPct, and per-phase crossAxisLimit override.
//
// ENV overrides:
//   DIR_DEG=20        — cone centre: degrees from east (0=east, 20=slightly south, 90=south)
//   CROSS_WIDTH=4     — max cells perpendicular to main axis (half-width)
//
// dirAngleDeg=20 means the path grows mostly eastward with 20° south tilt.
// crossAxisLimit=4 → perpendicular axis stays in [-4, 4] (9 tiles wide).

const PHASES = [

  // ── 1–10  Tutorial ─────────────────────────────────────────────
  // Levels 1-3: movement only
  // Levels 4-5: introduce fragile tiles gently (constraintMode = meaningful placement)
  // Levels 6-7: fragile becomes required
  // Levels 8-9: crumbling introduced
  // Level  10:  first real combined puzzle
  {
    label: "tutorial", from: 1, count: 10,
    constraints: { minMoves: 10, maxMoves: 30 },
    maxAttempts: 14,
    fn(i, seed, dirDeg, crossW) {
      const ti = phaseT(i, 10);
      let mechanics, patterns;
      if (i < 3) {
        mechanics = { fragile: false, crumbling: false, moving: false, portal: false };
        patterns  = [];
      } else if (i < 5) {
        mechanics = { fragile: true, crumbling: false, moving: false, portal: false,
                      fragileRate: 0.10, constraintMode: true };
        patterns  = ['FRAGILE_BRIDGE'];
      } else if (i < 7) {
        mechanics = { fragile: true, crumbling: false, moving: false, portal: false,
                      fragileRate: 0.25, constraintMode: true };
        patterns  = ['FRAGILE_BRIDGE'];
      } else if (i < 9) {
        mechanics = { fragile: true, crumbling: true, moving: false, portal: false,
                      fragileRate: 0.25, crumblingRate: 0.10, constraintMode: true };
        patterns  = ['ONE_TIME_PATH'];
      } else {
        mechanics = { fragile: true, crumbling: true, moving: false, portal: false,
                      fragileRate: 0.30, crumblingRate: 0.15, constraintMode: true };
        patterns  = ['FRAGILE_BRIDGE', 'ONE_TIME_PATH'];
      }
      return {
        seed,
        difficulty:   lerpRound(1, 3, ti),
        gridSize:     evenGrid(lerpRound(14, 22, ti)),
        mechanics,
        patterns,
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      130,
          deviationPct:   0.30,
          crossAxisLimit: crossW + 2,
        },
      };
    },
  },

  // ── 11–20  Fragile ──────────────────────────────────────────────
  {
    label: "fragile", from: 11, count: 10,
    constraints: { minMoves: 20, maxMoves: 50 },
    maxAttempts: 15,
    fn(i, seed, dirDeg, crossW) {
      const ti = phaseT(i, 10);
      return {
        seed,
        difficulty:  lerpRound(3, 6, ti),
        gridSize:    evenGrid(lerpRound(20, 28, ti)),
        mechanics: {
          fragile: true, crumbling: false, moving: false, portal: false,
          fragileRate: +lerp(0.05, 0.35, ti).toFixed(3),
          constraintMode: true,
        },
        patterns: ['FRAGILE_BRIDGE'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      80,
          deviationPct:   0.15,
          crossAxisLimit: crossW,
        },
      };
    },
  },

  // ── 21–30  Crumbling ────────────────────────────────────────────
  {
    label: "crumbling", from: 21, count: 10,
    constraints: { minMoves: 35, maxMoves: 58 },
    maxAttempts: 15,
    fn(i, seed, dirDeg, crossW) {
      const ti = phaseT(i, 10);
      return {
        seed,
        difficulty:  lerpRound(5, 7, ti),
        gridSize:    evenGrid(lerpRound(24, 32, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: false, portal: false,
          fragileRate:   0.35,
          crumblingRate: +lerp(0.03, 0.18, ti).toFixed(3),
          constraintMode: true,
        },
        patterns: ['FRAGILE_BRIDGE', 'ONE_TIME_PATH'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      90,
          deviationPct:   0.20,
          crossAxisLimit: crossW + 1,
        },
      };
    },
  },

  // ── 31–40  Moving ───────────────────────────────────────────────
  {
    label: "moving", from: 31, count: 10,
    constraints: { minMoves: 42, maxMoves: 70 },
    maxAttempts: 120,
    fn(i, seed, dirDeg, crossW) {
      const ti = phaseT(i, 10);
      return {
        seed,
        difficulty:  lerpRound(6, 9, ti),
        gridSize:    evenGrid(lerpRound(28, 36, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: true, portal: false,
          fragileRate:   0.35,
          crumblingRate: 0.18,
          constraintMode: true,
        },
        patterns: ['FRAGILE_BRIDGE', 'ONE_TIME_PATH'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      100,
          deviationPct:   0.25,
          crossAxisLimit: crossW + 2,
        },
      };
    },
  },

  // ── 41–45  Islands ──────────────────────────────────────────────
  {
    label: "islands", from: 41, count: 5,
    constraints: { minMoves: 28, maxMoves: 65 },
    maxAttempts: 20,
    fn(i, seed, dirDeg, crossW) {
      const ti = phaseT(i, 5);
      return {
        seed,
        difficulty:  lerpRound(7, 9, ti),
        gridSize:    evenGrid(lerpRound(28, 36, ti)),
        mechanics: { fragile: false, crumbling: false, moving: false, portal: true },
        patterns:  [],   // island levels use portal chains — patterns not applicable
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      70,
          deviationPct:   0.15,
          crossAxisLimit: crossW,
        },
      };
    },
  },

  // ── 46–50  ABYSS ────────────────────────────────────────────────
  {
    label: "abyss", from: 46, count: 5,
    constraints: { minMoves: 42, maxMoves: 75 },
    maxAttempts: 20,
    fn(i, seed, dirDeg, crossW) {
      const ti = phaseT(i, 5);
      return {
        seed,
        difficulty:  lerpRound(9, 10, ti),
        gridSize:    evenGrid(lerpRound(34, 40, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: true, portal: true,
          fragileRate:   0.35,
          crumblingRate: 0.18,
          constraintMode: true,
        },
        patterns: ['FRAGILE_BRIDGE', 'ONE_TIME_PATH', 'PRECISION_CORRIDOR'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      120,
          deviationPct:   0.30,
          crossAxisLimit: crossW + 3,
        },
      };
    },
  },
];

// ---- Double-check: JSON shape + full simulation --------------------
function doubleCheck(clean) {
  // Check 1: shape
  const required = ['level_metadata','start_state','hole_pos','tiles','solution_data'];
  for (const k of required) {
    if (!(k in clean)) return { ok: false, reason: `missing field: ${k}` };
  }
  if (!Array.isArray(clean.tiles) || clean.tiles.length === 0)
    return { ok: false, reason: 'empty tiles array' };
  if (!Array.isArray(clean.solution_data) || clean.solution_data.length === 0)
    return { ok: false, reason: 'empty solution_data' };

  // Check 2: full physics simulation
  const sim = simulateLevel(clean);
  if (!sim.ok) return { ok: false, reason: `sim fail step=${sim.step} ${sim.reason}` };

  return { ok: true };
}

// ---- Main ----------------------------------------------------------
async function main() {
  const baseSeed = process.env.BASE_SEED !== undefined && process.env.BASE_SEED !== ""
    ? Number(process.env.BASE_SEED)
    : Math.floor(Math.random() * 0xFFFF_FFFF);
  if (!Number.isFinite(baseSeed)) { console.error("BASE_SEED must be a number"); process.exit(1); }

  // Global layout direction (degrees from east, clockwise).
  // 0 = pure east, 20 = 20° south of east, 90 = south, 180 = west, etc.
  const dirDeg = process.env.DIR_DEG !== undefined ? Number(process.env.DIR_DEG) : 20;
  if (!Number.isFinite(dirDeg)) { console.error("DIR_DEG must be a number"); process.exit(1); }

  // Global cross-axis half-width (max cells perpendicular to main direction).
  const crossW = process.env.CROSS_WIDTH !== undefined ? Number(process.env.CROSS_WIDTH) : 4;
  if (!Number.isFinite(crossW) || crossW < 0) { console.error("CROSS_WIDTH must be a non-negative number"); process.exit(1); }

  const outDir = path.resolve(PROJECT_ROOT, process.env.LEVELS_OUT ?? "levels");
  await fs.mkdir(outDir, { recursive: true });

  const dirLabel = dirDeg === 0 ? "east" : dirDeg > 0 ? `east+${dirDeg}°S` : `east${dirDeg}°N`;
  console.log(`\nAbyss Block — توليد ٥٠ مرحلة مُتحقَّق منها`);
  console.log(`BASE_SEED=${baseSeed}  DIR_DEG=${dirDeg} (${dirLabel})  CROSS_WIDTH=${crossW}  →  ${outDir}/\n`);

  let totalOk = 0, totalFallback = 0;
  const difficultyLog = []; // { slot, computed, label }

  for (const phase of PHASES) {
    const end = phase.from + phase.count - 1;
    console.log(`── ${phase.label.toUpperCase()} (${phase.from}–${end})`);

    for (let i = 0; i < phase.count; i++) {
      const slot = phase.from + i;
      const seed = hashSeed(baseSeed, slot);
      const args = phase.fn(i, seed, dirDeg, crossW);

      // Build + verify (with retry)
      const { lvl, attempts, verified } = buildLevelVerified(
        args, phase.constraints, phase.maxAttempts
      );

      // buildLevelVerified already ran: prune → BFS optimize → minMoves check.
      // Apply puzzle patterns if specified (requires _internal.pathStates).
      let finalLvl = lvl;
      const patternsToApply = args.patterns ?? [];
      if (patternsToApply.length > 0 && lvl._internal?.pathStates) {
        const patRng = makeRNG(hashSeed(baseSeed ^ 0xbeef_cafe, slot));
        const candidate = applyPatterns(lvl, patternsToApply, patRng);
        if (simulateLevel(candidate).ok) {
          finalLvl = candidate;
        }
      }
      // Strip _internal, stamp metadata.
      const { _internal, ...optimized } = finalLvl;
      const movesAfterOpt = optimized.solution_data.length;
      optimized.level_metadata = {
        ...optimized.level_metadata,
        id:         `lvl_${slot}`,
        slot,
        phase:      phase.label,
        difficulty: args.difficulty,
        mechanics:  args.mechanics,
        generator:  {
          base_seed:      baseSeed,
          attempts,
          verified,
          dir_angle_deg:  args.expansionOpts.dirAngleDeg ?? 0,
          spreadDeg:      args.expansionOpts.spreadDeg   ?? 360,
          deviationPct:   args.expansionOpts.deviationPct ?? 0,
          crossAxisLimit: args.expansionOpts.crossAxisLimit ?? 0,
        },
      };
      const shortened = false; // BFS already applied inside buildLevelVerified

      // Compute tile stats, critical tiles, and behavioral difficulty
      const stats         = tileStats(optimized);
      const criticalTiles = computeCriticalTiles(optimized);
      const metrics       = computeBehavioralMetrics(optimized, criticalTiles);
      const score         = metrics.behavioral_difficulty;
      optimized.level_metadata = {
        ...optimized.level_metadata,
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
        },
        applied_patterns: finalLvl._internal?.appliedPatterns ?? [],
      };
      difficultyLog.push({ slot, computed: score, label: phase.label });

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
      const optTag      = shortened ? `  ✂${movesBeforeOpt}→${movesAfterOpt}` : "";
      const trapTag     = `  traps=${stats.fragile}f/${stats.crumbling}c/${stats.moving}m`
                        + `  ρ=${stats.trap_density}`;
      const mb = optimized.level_metadata.map_bounds;
      const mapTag = mb ? `  map=${mb.width}×${mb.length}` : "";

      const behavTag = `  prec=${metrics.precision_moves}  crumb=${metrics.crumbling_moves}  crit=${criticalTiles.size}`;
      console.log(
        `  ${verifyTag} ${String(slot).padStart(2)}`
        + `  D${args.difficulty}→${score}`
        + `  moves=${movesAfterOpt}`
        + `  tiles=${optimized.tiles.length}`
        + mapTag
        + trapTag
        + behavTag
        + islandTag
        + optTag
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

  console.log(`تم — ${totalOk}/50 مرحلة معتمدة` + (totalFallback ? ` ⚠ ${totalFallback} fallback` : " ✓ جميعها صحيحة"));

  // ── Difficulty ordering report ──────────────────────────────────────
  console.log("\n── Difficulty ordering (computed_difficulty)");
  let prevScore = 0, orderOk = true;
  for (const { slot, computed, label } of difficultyLog) {
    const arrow = computed >= prevScore ? "▲" : "▼";
    const warn  = computed < prevScore ? " ⚠ OUT OF ORDER" : "";
    if (computed < prevScore) orderOk = false;
    console.log(`  ${arrow} ${String(slot).padStart(2)}  [${label.padEnd(9)}]  score=${computed}${warn}`);
    prevScore = computed;
  }
  console.log(orderOk ? "\n  ✓ All levels increase in computed difficulty" : "\n  ⚠ Some levels are out of difficulty order — consider adjusting phase params");
}

main().catch(e => { console.error(e); process.exit(1); });
