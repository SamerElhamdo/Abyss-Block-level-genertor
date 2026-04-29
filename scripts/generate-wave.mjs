#!/usr/bin/env node
/**
 * يولّد عشر مستويات لكل موجة (wave) ويكتبها كـ JSON برقم مستمر:
 *   الموجة 1 → levels/1.json … levels/10.json   (بدون أرضيات هشة، بدون ثقوب دودية)
 *   الموجة 2 → levels/11.json … levels/20.json (أرضيات هشة، بدون ثقوب دودية)
 *   الموجة 3 → levels/21.json … levels/30.json (هش + متداعي متداخل، بدون ثقوب دودية)
 *
 * المتغيرات البيئة:
 *   BASE_SEED  — عدد أساس لتفرّع البذور (افتراضي 4747)
 *   LEVELS_OUT — مجلد الإخراج (افتراضي levels)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLevel } from "../abyss-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

/** ثابت في كل الموجات: لا بوابات دودية أبداً */
const NO_PORTAL = { fragile: false, crumbling: false, moving: false, portal: false };

const WAVES = {
  1: {
    label: "wave1_plain",
    slotFrom: 1,
    description: "عشر مراحل بدون أرضيات هشة",
    mech: { ...NO_PORTAL, fragile: false, crumbling: false },
    difficultyRange: [2, 4],
    gridRange: [18, 26],
  },
  2: {
    label: "wave2_fragile",
    slotFrom: 11,
    description: "عشر مراحل مع أرضيات هشة",
    mech: { ...NO_PORTAL, fragile: true, crumbling: false },
    difficultyRange: [4, 7],
    gridRange: [22, 32],
  },
  3: {
    label: "wave3_fragile_crumbling",
    slotFrom: 21,
    description: "هشة + أرضيات متداعية (أصعب خطّة بدون بوابات)",
    mech: { ...NO_PORTAL, fragile: true, crumbling: true },
    difficultyRange: [6, 10],
    gridRange: [26, 40],
  },
};

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

/** تدرّج خطّي بين a و b لفهرس i من 0..steps-1 */
function lerpInt(a, b, i, steps = 10) {
  if (steps <= 1) return Math.round(a);
  const t = i / (steps - 1);
  return Math.round(a + (b - a) * t);
}

function parseWaveArg(argv) {
  const w = argv[2] ?? "help";
  if (w === "help" || w === "-h" || w === "--help") return null;
  const n = Number(w);
  if (![1, 2, 3].includes(n)) {
    console.error("استخدام: node scripts/generate-wave.mjs <1|2|3>");
    process.exit(1);
  }
  return n;
}

function hashSeed(base, wave, indexInWave) {
  let x = ((base >>> 0) ^ (wave * 0x9e3779b9) ^ ((indexInWave + 1) * 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x ^= x >>> 15;
  return x >>> 0;
}

async function main() {
  const waveNum = parseWaveArg(process.argv);
  if (waveNum == null) {
    console.log(`
مولّد الفوج (10 مستويات)

  node scripts/generate-wave.mjs 1   → levels/1.json … 10.json
  node scripts/generate-wave.mjs 2   → levels/11.json … 20.json
  node scripts/generate-wave.mjs 3   → levels/21.json … 30.json

ENV: BASE_SEED (افتراضي 4747)  LEVELS_OUT (افتراضي levels)
`);
    process.exit(0);
  }

  const baseSeed =
    process.env.BASE_SEED !== undefined && process.env.BASE_SEED !== ""
      ? Number(process.env.BASE_SEED)
      : 4747;
  if (!Number.isFinite(baseSeed)) {
    console.error("BASE_SEED يجب أن يكون عدداً");
    process.exit(1);
  }

  const outDir = path.resolve(PROJECT_ROOT, process.env.LEVELS_OUT ?? "levels");
  await fs.mkdir(outDir, { recursive: true });

  const cfg = WAVES[waveNum];

  console.log(`الموجة ${waveNum}: ${cfg.description}`);
  console.log(`BASE_SEED=${baseSeed}  → ${outDir}/`);

  for (let i = 0; i < 10; i++) {
    const slot = cfg.slotFrom + i;
    const seed = hashSeed(baseSeed, waveNum, i);
    const difficulty = lerpInt(cfg.difficultyRange[0], cfg.difficultyRange[1], i);
    let gridSize = clamp(lerpInt(cfg.gridRange[0], cfg.gridRange[1], i), 12, 40);
    if (gridSize % 2 !== 0) gridSize -= 1;

    const lvl = buildLevel({
      difficulty,
      seed,
      mechanics: cfg.mech,
      gridSize,
    });

    const { _internal, ...clean } = lvl;
    clean.level_metadata = {
      ...clean.level_metadata,
      id: `lvl_${slot}`,
      generator: {
        wave: waveNum,
        wave_label: cfg.label,
        slot_in_set: i + 1,
        slot_global: slot,
        base_seed: baseSeed >>> 0,
        mechanics: cfg.mech,
      },
    };

    const filePath = path.join(outDir, `${slot}.json`);
    await fs.writeFile(filePath, JSON.stringify(clean, null, 2), "utf8");
    console.log(
      `  ✓ ${slot}.json  D${difficulty}  grid=${gridSize}  seed=${seed}  moves=${clean.solution_data.length}`
    );
  }

  console.log("تم.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
