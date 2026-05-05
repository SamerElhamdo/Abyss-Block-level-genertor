#!/usr/bin/env node
/**
 * Abyss Block — توليد مراحل مُتحقَّق منها (متعدد المتغيرات)
 *
 * يولّد أفضل K متغيرات لكل مرحلة بدلاً من واحد فقط.
 *
 * متغيرات البيئة:
 *   LEVEL_COUNT  — عدد المراحل (افتراضي: 20)
 *   TOP_K        — عدد المتغيرات لكل مرحلة (افتراضي: 5)
 *   DIFF_MIN     — صعوبة المرحلة الأولى (افتراضي: 3.5)
 *   DIFF_MAX     — صعوبة المرحلة الأخيرة (افتراضي: 9.5)
 *   DIFF_SIGMA   — تسامح مطابقة الهدف (افتراضي: 1.2)
 *   EVOLUTION_N  — عدد المرشحين لكل مرحلة (افتراضي: 20)
 *   BASE_SEED    — البذرة الأساسية
 *   DIR_DEG      — اتجاه المسار (افتراضي: 20)
 *   CROSS_WIDTH  — نصف عرض الممر (افتراضي: 3)
 *   LEVELS_OUT   — مجلد الإخراج (افتراضي: levels-variants/)
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

async function main() {
  const baseSeed = process.env.BASE_SEED !== undefined && process.env.BASE_SEED !== ""
    ? Number(process.env.BASE_SEED) : Math.floor(Math.random() * 0xFFFF_FFFF);
  const dirDeg     = process.env.DIR_DEG     !== undefined ? Number(process.env.DIR_DEG)     : 20;
  const crossW     = process.env.CROSS_WIDTH !== undefined ? Number(process.env.CROSS_WIDTH) : 3;
  const evolutionN = process.env.EVOLUTION_N !== undefined ? Math.max(1, Math.round(Number(process.env.EVOLUTION_N))) : 20;
  const levelCount = process.env.LEVEL_COUNT !== undefined ? Math.max(5, Math.round(Number(process.env.LEVEL_COUNT))) : 20;
  const topK       = process.env.TOP_K       !== undefined ? Math.max(1, Math.round(Number(process.env.TOP_K)))       : 5;
  const diffMin    = process.env.DIFF_MIN    !== undefined ? Number(process.env.DIFF_MIN)    : 2.5;
  const diffMax    = process.env.DIFF_MAX    !== undefined ? Number(process.env.DIFF_MAX)    : 7.5;
  const diffSigma  = process.env.DIFF_SIGMA  !== undefined ? Number(process.env.DIFF_SIGMA)  : 1.2;
  const outDir     = path.resolve(PROJECT_ROOT, process.env.LEVELS_OUT ?? "levels-variants");
  await fs.mkdir(outDir, { recursive: true });

  const PHASES  = buildPhases(levelCount);
  const targets = computeTargets(levelCount, diffMin, diffMax);

  console.log(`\nAbyss Block — توليد ${levelCount} مرحلة (أفضل ${topK} متغيرات لكل منها)`);
  console.log(`BASE_SEED=${baseSeed}  EVOLUTION_N=${evolutionN}  TOP_K=${topK}  DIR_DEG=${dirDeg}  CROSS_WIDTH=${crossW}\n`);

  for (const phase of PHASES) {
    const end = phase.from + phase.count - 1;
    console.log(`── ${phase.label.toUpperCase()} (${phase.from}–${end})`);

    for (let i = 0; i < phase.count; i++) {
      const slot   = phase.from + i;
      const target = targets[slot - 1];
      const candidates = [];

      for (let ei = 0; ei < evolutionN; ei++) {
        const evoSeed = ei === 0
          ? hashSeed(baseSeed, slot)
          : hashSeed(baseSeed ^ (ei * 0x9e3779b1), slot);
        const result = buildScoredCandidate(slot, evoSeed, phase, i, dirDeg, crossW);
        if (!result) continue;
        const sel = selectionScore(result.fitness, result.score, target, diffSigma);
        candidates.push({ ...result, evoSeed, evoIdx: ei, selScore: sel });
      }

      candidates.sort((a, b) => b.selScore - a.selScore);
      const topSelected = candidates.slice(0, topK);

      if (topSelected.length === 0) {
        console.error(`  ✗ ${slot} all candidates failed`);
        continue;
      }

      let savedCount = 0;
      for (let rank = 0; rank < topSelected.length; rank++) {
        const variant = topSelected[rank];
        const {
          optimized, args, metrics, stats, criticalTiles,
          attempts, verified, score, fitness, movesAfterOpt,
          evoSeed, evoIdx, selScore, finalLvl,
        } = variant;
        const rankIdx = rank + 1;
        const delta   = +(score - target).toFixed(2);

        optimized.level_metadata = {
          ...optimized.level_metadata,
          id:            `lvl_${slot}_v${rankIdx}`,
          slot,
          variant_rank:  rankIdx,
          phase:         phase.label,
          target_difficulty: target,
          mechanics:     args.mechanics,
          evolution: {
            n_candidates:      evolutionN,
            winner_index:      evoIdx,
            winner_seed:       evoSeed,
            selection_score:   +selScore.toFixed(4),
            fitness_best:      fitness,
            score_best:        score,
            delta_from_target: delta,
          },
          steps_to_solve:      movesAfterOpt,
          tile_stats:          stats,
          computed_difficulty: score,
          behavioral_analysis: {
            ...metrics,
            critical_tile_count: criticalTiles.size,
            puzzle_efficiency:   fitness,
          },
          applied_patterns: finalLvl._internal?.appliedPatterns ?? [],
        };

        const dc = doubleCheck(optimized);
        if (dc.ok) {
          const fileName = `${slot}_${rankIdx}.json`;
          await fs.writeFile(path.join(outDir, fileName), JSON.stringify(optimized, null, 2), "utf8");
          savedCount++;
        }
      }

      console.log(
        `  ✓ ${slot}  saved ${savedCount}/${topSelected.length} variants`
        + `  best: got=${topSelected[0].score} fit=${topSelected[0].fitness} mv=${topSelected[0].movesAfterOpt}`
        + `  traps=${topSelected[0].stats.fragile}f/${topSelected[0].stats.crumbling}c`
      );
    }
    console.log();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
