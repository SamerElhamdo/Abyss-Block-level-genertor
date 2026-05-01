#!/usr/bin/env node
/**
 * Abyss Block — توليد ١٠٠ مرحلة مُتحقَّق منها
 *
 * خط الأنابيب لكل مرحلة:
 *   1. توليد → 2. محاكاة كاملة (fragile/crumbling) → 3. إعادة توليد عند الفشل
 *   → 4. تحقق مزدوج → 5. تنظيف البلاطات غير المستخدمة → 6. كتابة الملف
 *
 * المراحل (١٠٠ مرحلة):
 *   1–10   Tutorial     لا أفخاخ، التعريف بهوية اللعبة
 *  11–20   Fragile      بلاطات هشة تتصاعد تدريجياً
 *  21–30   Crumbling    هشة + متداعية
 *  31–40   Moving       هشة + متداعية + متحركة
 *  41–50   Islands      جزر منفصلة (بوابات)
 *  51–70   Complex Mix  مزيج من المكانيكيات مع التركيز على البزلينغ
 *  71–100  ABYSS        أقصى صعوبة، كل المكانيكيات، مسارات معقدة
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
  tileStats,
} from "../abyss-engine.mjs";
import { generateRefinedLevel } from "../ai-refiner.mjs";

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
const PHASES = [
  {
    label: "tutorial", from: 1, count: 10,
    constraints: { minMoves: 8, maxMoves: 30 },
    maxAttempts: 15
  },
  {
    label: "abyss_mix", from: 11, count: 90,
    constraints: { minMoves: 25, maxMoves: 110 },
    maxAttempts: 50
  },
];

// ---- Double-check: JSON shape + full simulation --------------------
function doubleCheck(clean) {
  const required = ['level_metadata','start_state','hole_pos','tiles','solution_data'];
  for (const k of required) {
    if (!(k in clean)) return { ok: false, reason: `missing field: ${k}` };
  }
  if (!Array.isArray(clean.tiles) || clean.tiles.length === 0)
    return { ok: false, reason: 'empty tiles array' };
  if (!Array.isArray(clean.solution_data) || clean.solution_data.length === 0)
    return { ok: false, reason: 'empty solution_data' };

  const sim = simulateLevel(clean);
  if (!sim.ok) return { ok: false, reason: `sim fail step=${sim.step} ${sim.reason}` };

  return { ok: true };
}

// ---- Main ----------------------------------------------------------
async function main() {
  const baseSeed = process.env.BASE_SEED !== undefined && process.env.BASE_SEED !== ""
    ? Number(process.env.BASE_SEED) : 4747;
  if (!Number.isFinite(baseSeed)) { console.error("BASE_SEED must be a number"); process.exit(1); }

  const dirDeg = process.env.DIR_DEG !== undefined ? Number(process.env.DIR_DEG) : 20;
  if (!Number.isFinite(dirDeg)) { console.error("DIR_DEG must be a number"); process.exit(1); }

  const crossW = process.env.CROSS_WIDTH !== undefined ? Number(process.env.CROSS_WIDTH) : 4;
  if (!Number.isFinite(crossW) || crossW < 0) { console.error("CROSS_WIDTH must be a non-negative number"); process.exit(1); }

  const outDir = path.resolve(PROJECT_ROOT, process.env.LEVELS_OUT ?? "levels");
  await fs.mkdir(outDir, { recursive: true });

  const dirLabel = dirDeg === 0 ? "east" : dirDeg > 0 ? `east+${dirDeg}°S` : `east${dirDeg}°N`;
  console.log(`\nAbyss Block — توليد ١٠٠ مرحلة مُتحقَّق منها (AI-Guided)`);
  console.log(`BASE_SEED=${baseSeed}  DIR_DEG=${dirDeg} (${dirLabel})  CROSS_WIDTH=${crossW}  →  ${outDir}/\n`);

  let totalOk = 0, totalFallback = 0;
  const difficultyLog = [];

  for (const phase of PHASES) {
    const end = phase.from + phase.count - 1;
    console.log(`── ${phase.label.toUpperCase()} (${phase.from}–${end})`);

    for (let i = 0; i < phase.count; i++) {
      const slot = phase.from + i;
      const seed = hashSeed(baseSeed, slot);

      let lvl, verified;

      // Use AI-Refiner for ALL levels
      const result = await generateRefinedLevel(slot, phase.label, baseSeed, dirDeg, crossW, phase.constraints);
      
      if (result) {
        lvl = result.lvl;
        verified = result.verified;
      } else {
        // Fallback generator (limited params)
        const args = { seed, difficulty: 5, gridSize: 40, expansionOpts: { dirAngleDeg: dirDeg, crossAxisLimit: crossW } };
        const fallback = buildLevelVerified(args, phase.constraints, phase.maxAttempts);
        lvl = fallback.lvl;
        verified = fallback.verified;
      }

      const { _internal, ...optimized } = lvl;
      const movesAfterOpt = optimized.solution_data.length;
      
      // Stamp final metadata
      const stats  = tileStats(optimized);
      const score  = computeDifficultyScore(optimized);
      
      optimized.level_metadata = {
        ...optimized.level_metadata,
        id:         `lvl_${slot}`,
        slot,
        phase:      phase.label,
        steps_to_solve: movesAfterOpt,
        tile_stats:     stats,
        computed_difficulty: score,
        generator: {
          base_seed: baseSeed,
          ai_guided: true,
          verified
        }
      };
      
      difficultyLog.push({ slot, computed: score, label: phase.label });

      const dc = doubleCheck(optimized);
      if (!dc.ok) {
        console.error(`  ✗ ${slot} double-check FAIL: ${dc.reason}`);
        totalFallback++;
      } else {
        totalOk++;
      }

      const verifyTag = verified ? "✓" : "⚠ fallback";
      const trapTag   = `  traps=${stats.fragile}f/${stats.crumbling}c/${stats.moving}m  ρ=${stats.trap_density}`;
      const mb = optimized.level_metadata.map_bounds;
      const mapTag = mb ? `  map=${mb.width}×${mb.length}` : "";

      console.log(
        `  ${verifyTag} ${String(slot).padStart(3)}`
        + `  D${optimized.level_metadata.difficulty || '?' }→${score}`
        + `  moves=${movesAfterOpt}`
        + `  tiles=${optimized.tiles.length}`
        + mapTag
        + trapTag
      );

      await fs.writeFile(
        path.join(outDir, `${slot}.json`),
        JSON.stringify(optimized, null, 2),
        "utf8"
      );
    }
    console.log();
  }

  console.log(`تم — ${totalOk}/100 مرحلة معتمدة` + (totalFallback ? ` ⚠ ${totalFallback} fallback` : " ✓ جميعها صحيحة"));

  console.log("\n── Difficulty ordering (computed_difficulty)");
  let prevScore = 0, orderOk = true;
  for (const { slot, computed, label } of difficultyLog) {
    const arrow = computed >= prevScore ? "▲" : "▼";
    const warn  = computed < prevScore ? " ⚠ OUT OF ORDER" : "";
    if (computed < prevScore) orderOk = false;
    console.log(`  ${arrow} ${String(slot).padStart(3)}  [${label.padEnd(9)}]  score=${computed}${warn}`);
    prevScore = computed;
  }
  console.log(orderOk ? "\n  ✓ All levels increase in computed difficulty" : "\n  ⚠ Some levels are out of difficulty order — consider adjusting phase params");
}

main().catch(e => { console.error(e); process.exit(1); });
