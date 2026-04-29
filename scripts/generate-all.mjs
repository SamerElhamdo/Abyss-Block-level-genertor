#!/usr/bin/env node
/**
 * توليد ٥٠ مرحلة كاملة لـ Abyss Block — مرحلة واحدة لكل ملف JSON.
 *
 * التدرّج:
 *   1–10   Tutorial    لا أفخاخ،   صعوبة خفيفة جداً
 *  11–20   Fragile     بلاطات هشة  تتصاعد تدريجياً
 *  21–30   Crumbling   هشة + متداعية
 *  31–40   Moving      هشة + متداعية + منصات متحركة
 *  41–45   Islands     جزر منفصلة بالبوابات (بدون أفخاخ أخرى)
 *  46–50   ABYSS       كل شيء مدمج
 *
 * الاستخدام:
 *   node scripts/generate-all.mjs
 *   BASE_SEED=1234 node scripts/generate-all.mjs
 *   LEVELS_OUT=dist/levels node scripts/generate-all.mjs
 */

import fs   from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLevel } from "../abyss-engine.mjs";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ---- helpers -------------------------------------------------------
function lerp(a, b, t)        { return a + (b - a) * t; }
function lerpRound(a, b, t)   { return Math.round(lerp(a, b, t)); }
/** t ∈ [0,1] within a phase of `n` slots */
function t(i, n)              { return n <= 1 ? 1 : i / (n - 1); }
/** unique deterministic seed per slot */
function hashSeed(base, slot) {
  let x = ((base >>> 0) ^ (slot * 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x ^= x >>> 15;
  return x >>> 0;
}
function evenGrid(n) { return n % 2 === 0 ? n : n - 1; }

// ---- phase definitions ---------------------------------------------
//  Each entry: { label, from, count, fn(i, seed) → buildLevel args }
const PHASES = [

  // ── Phase 1: Tutorial (1–10) ─────────────────────────────────────
  {
    label: "tutorial",
    from: 1,
    count: 10,
    fn(i, seed) {
      const ti = t(i, 10);
      return {
        seed,
        difficulty: lerpRound(1, 3, ti),
        gridSize:   evenGrid(lerpRound(14, 22, ti)),
        mechanics:  { fragile: false, crumbling: false, moving: false, portal: false },
        expansionOpts: {},
      };
    },
  },

  // ── Phase 2: Fragile (11–20) ─────────────────────────────────────
  // fragileRate climbs from 0.05 → 0.35; difficulty & grid grow too
  {
    label: "fragile",
    from: 11,
    count: 10,
    fn(i, seed) {
      const ti = t(i, 10);
      return {
        seed,
        difficulty: lerpRound(3, 6, ti),
        gridSize:   evenGrid(lerpRound(20, 28, ti)),
        mechanics: {
          fragile:    true,
          crumbling:  false,
          moving:     false,
          portal:     false,
          fragileRate: +lerp(0.05, 0.35, ti).toFixed(3),
        },
        expansionOpts: {},
      };
    },
  },

  // ── Phase 3: Crumbling (21–30) ───────────────────────────────────
  // crumblingRate climbs 0.03 → 0.18; fragile stays at full rate
  {
    label: "crumbling",
    from: 21,
    count: 10,
    fn(i, seed) {
      const ti = t(i, 10);
      return {
        seed,
        difficulty: lerpRound(5, 7, ti),
        gridSize:   evenGrid(lerpRound(24, 32, ti)),
        mechanics: {
          fragile:       true,
          crumbling:     true,
          moving:        false,
          portal:        false,
          fragileRate:   0.35,
          crumblingRate: +lerp(0.03, 0.18, ti).toFixed(3),
        },
        expansionOpts: {},
      };
    },
  },

  // ── Phase 4: Moving (31–40) ──────────────────────────────────────
  {
    label: "moving",
    from: 31,
    count: 10,
    fn(i, seed) {
      const ti = t(i, 10);
      return {
        seed,
        difficulty: lerpRound(6, 9, ti),
        gridSize:   evenGrid(lerpRound(28, 36, ti)),
        mechanics: {
          fragile:       true,
          crumbling:     true,
          moving:        true,
          portal:        false,
          fragileRate:   0.35,
          crumblingRate: 0.18,
        },
        expansionOpts: {},
      };
    },
  },

  // ── Phase 5: Islands / Portals (41–45) ───────────────────────────
  // Clean paths, no other traps — islands are the challenge
  {
    label: "islands",
    from: 41,
    count: 5,
    fn(i, seed) {
      const ti = t(i, 5);
      return {
        seed,
        difficulty: lerpRound(7, 9, ti),
        gridSize:   evenGrid(lerpRound(28, 36, ti)),
        mechanics: {
          fragile:   false,
          crumbling: false,
          moving:    false,
          portal:    true,        // triggers island mode
        },
        expansionOpts: {},
      };
    },
  },

  // ── Phase 6: ABYSS — all mechanics combined (46–50) ──────────────
  {
    label: "abyss",
    from: 46,
    count: 5,
    fn(i, seed) {
      const ti = t(i, 5);
      return {
        seed,
        difficulty: lerpRound(9, 10, ti),
        gridSize:   evenGrid(lerpRound(34, 40, ti)),
        mechanics: {
          fragile:       true,
          crumbling:     true,
          moving:        true,
          portal:        true,
          fragileRate:   0.35,
          crumblingRate: 0.18,
        },
        expansionOpts: {},
      };
    },
  },
];

// ---- main ----------------------------------------------------------
async function main() {
  const baseSeed = process.env.BASE_SEED !== undefined && process.env.BASE_SEED !== ""
    ? Number(process.env.BASE_SEED) : 4747;
  if (!Number.isFinite(baseSeed)) {
    console.error("BASE_SEED يجب أن يكون رقماً صحيحاً"); process.exit(1);
  }

  const outDir = path.resolve(PROJECT_ROOT, process.env.LEVELS_OUT ?? "levels");
  await fs.mkdir(outDir, { recursive: true });

  console.log(`\nAbyss Block — توليد ٥٠ مرحلة`);
  console.log(`BASE_SEED=${baseSeed}  →  ${outDir}/\n`);

  let totalGenerated = 0;

  for (const phase of PHASES) {
    console.log(`── ${phase.label.toUpperCase()} (${phase.from}–${phase.from + phase.count - 1})`);

    for (let i = 0; i < phase.count; i++) {
      const slot = phase.from + i;
      const seed = hashSeed(baseSeed, slot);
      const args = phase.fn(i, seed);

      const lvl = buildLevel(args);
      const { _internal, ...clean } = lvl;

      // stamp metadata
      clean.level_metadata = {
        ...clean.level_metadata,
        id: `lvl_${slot}`,
        slot,
        phase: phase.label,
        difficulty: args.difficulty,
        mechanics: args.mechanics,
      };

      const filePath = path.join(outDir, `${slot}.json`);
      await fs.writeFile(filePath, JSON.stringify(clean, null, 2), "utf8");

      const islandTag = clean.level_metadata.island_count
        ? `  islands=${clean.level_metadata.island_count}` : "";
      const tileCount = clean.tiles.length;
      console.log(
        `  ✓ ${String(slot).padStart(2)}  D${args.difficulty}`
        + `  grid=${args.gridSize}`
        + `  moves=${clean.solution_data.length}`
        + `  tiles=${tileCount}`
        + islandTag
      );
      totalGenerated++;
    }
    console.log();
  }

  console.log(`تم — ${totalGenerated} مرحلة في ${outDir}/`);
}

main().catch(e => { console.error(e); process.exit(1); });
