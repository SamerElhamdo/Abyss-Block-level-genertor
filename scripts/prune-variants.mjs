#!/usr/bin/env node
/**
 * Abyss Block — سكربت التقليم والترتيب
 * 
 * يأخذ المجلد الناتج عن توليد المتغيرات، ويرتبها جميعاً في تسلسل واحد
 * مع تحديث البيانات الوصفية (ID, Slot, Target Difficulty).
 *
 * متغيرات البيئة:
 *   INPUT_DIR   — مجلد المتغيرات (افتراضي: levels-variants)
 *   OUTPUT_DIR  — مجلد الإخراج النهائي (افتراضي: levels-pruned)
 *   DIFF_MIN    — بداية منحنى الصعوبة الجديد (افتراضي: 3.5)
 *   DIFF_MAX    — نهاية منحنى الصعوبة الجديد (افتراضي: 9.5)
 */

import fs   from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

function lerp(a, b, t) { return a + (b - a) * t; }

async function main() {
  const inputDir  = path.resolve(PROJECT_ROOT, process.env.INPUT_DIR ?? "levels-variants");
  const outputDir = path.resolve(PROJECT_ROOT, process.env.OUTPUT_DIR ?? "levels-pruned");
  
  const diffMin = process.env.DIFF_MIN !== undefined ? Number(process.env.DIFF_MIN) : 3.5;
  const diffMax = process.env.DIFF_MAX !== undefined ? Number(process.env.DIFF_MAX) : 9.5;

  await fs.mkdir(outputDir, { recursive: true });

  const files = await fs.readdir(inputDir);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  // 1. استخراج المعلومات والفرز
  const variantData = [];
  for (const file of jsonFiles) {
    const match = file.match(/^(\d+)_(\d+)\.json$/);
    if (match) {
      const slot = parseInt(match[1], 10);
      const rank = parseInt(match[2], 10);
      variantData.push({ file, slot, rank });
    }
  }

  // الترتيب حسب السلوت (المرحلة الأصلية) ثم الرتبة (الأفضل فالأفضل)
  variantData.sort((a, b) => {
    if (a.slot !== b.slot) return a.slot - b.slot;
    return a.rank - b.rank;
  });

  console.log(`\nAbyss Block — سكربت التقليم`);
  console.log(`جارٍ معالجة ${variantData.length} ملف من ${inputDir} إلى ${outputDir}...\n`);

  const totalLevels = variantData.length;

  // 2. إعادة الكتابة مع تحديث البيانات
  for (let i = 0; i < totalLevels; i++) {
    const entry = variantData[i];
    const newSlot = i + 1;
    
    const content = await fs.readFile(path.join(inputDir, entry.file), 'utf8');
    const level = JSON.parse(content);

    // حساب الصعوبة المستهدفة الجديدة بناءً على التسلسل الكلي
    const t = totalLevels <= 1 ? 1 : i / (totalLevels - 1);
    const newTargetDiff = +lerp(diffMin, diffMax, t).toFixed(3);

    // تحديث البيانات الوصفية
    level.level_metadata = {
      ...level.level_metadata,
      id: `lvl_${newSlot}`,
      slot: newSlot,
      original_source: {
        slot: entry.slot,
        rank: entry.rank,
        file: entry.file
      },
      target_difficulty: newTargetDiff
    };

    const outName = `${newSlot}.json`;
    await fs.writeFile(path.join(outputDir, outName), JSON.stringify(level, null, 2), 'utf8');

    if (newSlot % 10 === 0 || newSlot === totalLevels) {
      console.log(`  ✓ تمت معالجة ${newSlot}/${totalLevels}`);
    }
  }

  console.log(`\nتم بنجاح! المخرجات موجودة في: ${outputDir}`);
}

main().catch(e => {
  console.error("Error during pruning:", e);
  process.exit(1);
});
