import fs from 'fs';
import path from 'path';
import { buildProblemFirstLevel } from '../problem-engine.mjs';

const OUT_DIR = 'levels-problem-50';
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

console.log("=== بدء التوليد بأسلوب اللغز أولاً (50 مرحلة متدرجة بجميع الميكانيكيات) ===");

// الأطوار الخمسة مع الميكانيكيات المطلوبة (تشبه تماماً هيكل المحرك القديم)
const PHASES = [
  { name: 'hard_start', count: 10, mech: { fragile: true, crumbling: true, moving: false, portal: false } },
  { name: 'precision',  count: 10, mech: { fragile: true, crumbling: true, moving: false, portal: false } },
  { name: 'moving',     count: 10, mech: { fragile: true, crumbling: true, moving: true,  portal: false } },
  { name: 'islands',    count: 10, mech: { fragile: true, crumbling: true, moving: false, portal: true  } },
  { name: 'abyss',      count: 10, mech: { fragile: true, crumbling: true, moving: true,  portal: true  } }
];

let slot = 1;

for (const phase of PHASES) {
  console.log(`\n── طور: ${phase.name.toUpperCase()} (${phase.count} مراحل) ──`);
  
  for (let i = 0; i < phase.count; i++) {
    const seed = 90000 + slot;
    
    // التدرج في الصعوبة داخل الطور نفسه وعلى مستوى اللعبة كاملة
    // كلما تقدمت اللعبة (slot يزيد)، تزداد مساحة الشبكة وتعقيد عملية النحت
    const progress = slot / 50; 
    const gridSize = Math.floor(7 + (progress * 10)); // الشبكة تكبر من 7 حتى 17
    const iterations = 1000 + Math.floor(progress * 4000); // دورات النحت من 1000 حتى 5000
    
    process.stdout.write(`  توليد ${slot.toString().padStart(2, '0')} (حجم: ${gridSize}x${gridSize}, نحت: ${iterations})... `);
    
    try {
      const level = buildProblemFirstLevel({
        seed,
        gridSize,
        iterations,
        mechanics: phase.mech
      });
      
      const diff = level.level_metadata.computed_difficulty;
      
      // جمع إحصائيات البلاطات للفحص
      const tiles = level.tiles;
      const tFragile = tiles.filter(t => t.type === 'fragile').length;
      const tCrumbling = tiles.filter(t => t.type === 'crumbling').length;
      const tMoving = tiles.filter(t => t.type === 'moving').length;
      const tPortal = tiles.filter(t => t.type === 'portal').length;
      const trapTag = `${tFragile}f/${tCrumbling}c/${tMoving}m/${tPortal}p`;
      
      console.log(`✓ (صعوبة: ${diff} | خطوات: ${level.solution_data.length} | ${trapTag})`);
      
      // حفظ بيانات اللعبة النهائية لتشغيلها بشكل مثالي في محرك اللعبة
      level.level_metadata.slot = slot;
      level.level_metadata.phase = phase.name; 
      level.level_metadata.computed_difficulty = diff;
      
      fs.writeFileSync(
        path.join(OUT_DIR, `${slot}.json`),
        JSON.stringify(level, null, 2)
      );
    } catch (err) {
      console.log(`❌ فشل: ${err.message}`);
    }
    
    slot++;
  }
}

console.log(`\n✅ تم الانتهاء! تم حفظ 50 مرحلة في مجلد: ${OUT_DIR}/`);
