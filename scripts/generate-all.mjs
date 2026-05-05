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
  hashSeed, selectionScore, computeTargets, buildPhases,
  buildScoredCandidate, doubleCheck,
} from "./shared-generator.mjs";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

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

  const diffMin = process.env.DIFF_MIN !== undefined ? Number(process.env.DIFF_MIN) : 2.5;
  const diffMax = process.env.DIFF_MAX !== undefined ? Number(process.env.DIFF_MAX) : 7.5;
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

      const dc = doubleCheck(optimized);
      if (!dc.ok) {
        console.error(`  ✗ ${slot} double-check FAIL: ${dc.reason}`);
        totalFallback++;
        continue;
      }
      totalOk++;

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
