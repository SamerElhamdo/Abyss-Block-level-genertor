import fs from 'fs';
import path from 'path';
import { buildProblemFirstLevel } from '../problem-engine.mjs';

const OUT_DIR = 'levels-problem';
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

console.log("=== بدء التوليد بأسلوب اللغز أولاً (Destructive Carving) ===");

for (let i = 1; i <= 10; i++) {
  const seed = 50000 + i;
  
  // زيادة عدد المحاولات (Iterations) وحجم الشبكة تدريجياً لصنع مراحل أصعب
  const iterations = 1000 + (i * 100); 
  const gridSize = 8 + Math.floor(i / 3);
  
  process.stdout.write(`توليد المرحلة ${i} (بذرة: ${seed}, حجم: ${gridSize}x${gridSize}, دورات النحت: ${iterations})... `);
  
  try {
    const level = buildProblemFirstLevel({
      seed,
      gridSize,
      iterations,
      mechanics: { fragile: true, crumbling: true }
    });
    
    const diff = level.level_metadata.computed_difficulty;
    
    console.log(`✓ (خطوات: ${level.solution_data.length} | بلاطات: ${level.tiles.length} | صعوبة: ${diff})`);
    
    level.level_metadata.slot = i;
    level.level_metadata.phase = "abyss"; 
    
    fs.writeFileSync(
      path.join(OUT_DIR, `${i}.json`),
      JSON.stringify(level, null, 2)
    );
  } catch (err) {
    console.log(`❌ فشل: ${err.message}`);
  }
}

console.log(`\n✅ تم الانتهاء! تم حفظ المراحل في مجلد: ${OUT_DIR}/`);
