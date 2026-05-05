import fs from 'fs';
import { ProblemFirstGenerator } from './ProblemFirstGenerator.mjs';

function printLevel(levelData) {
  const { grid, start, goal } = levelData;
  console.log("\n=== خريطة المرحلة المولدة ===");
  
  for (let y = 0; y < grid.length; y++) {
    let rowStr = "";
    for (let x = 0; x < grid[y].length; x++) {
      if (start.x === x && start.y === y) {
        rowStr += "🟢"; // نقطة البداية
      } else if (goal.x === x && goal.y === y) {
        rowStr += "🔴"; // حفرة الهدف
      } else {
        const cell = grid[y][x];
        if (cell === 0) rowStr += "⬛️";     // فراغ
        else if (cell === 1) rowStr += "⬜️"; // مسار/بلاطة عادية
        else if (cell === 2) rowStr += "🟫"; // بلاطة هشة (لغز)
      }
    }
    console.log(rowStr);
  }
  console.log("==============================\n");
  console.log("الدليل: 🟢 البداية | 🔴 الهدف | ⬜️ بلاطة | 🟫 بلاطة هشة | ⬛️ فراغ");
}

function exportToJson(levelData, filename) {
  const { grid, start, goal, solutionLength, solutionData } = levelData;
  const tiles = [];

  // تحويل الشبكة ثنائية الأبعاد إلى مصفوفة كائنات (Objects) تناسب المحاكي
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const cell = grid[y][x];
      if (cell !== 0) {
        let tileType = "normal";
        if (cell === 2) tileType = "fragile";
        
        tiles.push({ x: x, z: y, type: tileType });
      }
    }
  }

  // بناء هيكل JSON مطابق للمعيار
  const levelJson = {
    level_metadata: {
      id: "problem_first_gen",
      slot: 1,
      phase: "abyss",
      target_difficulty: solutionLength,
      computed_difficulty: solutionLength,
      generator_mode: "problem_first",
      evolution: {
        n_candidates: 1,
        winner_index: 0,
        winner_seed: 123456,
        selection_score: 10.0
      },
      behavioral_analysis: {
        precision_moves: 2,
        behavioral_difficulty: solutionLength,
        puzzle_efficiency: 5.0
      }
    },
    start_state: {
      pos: { x: start.x, z: start.y },
      orientation: "vertical"
    },
    hole_pos: { x: goal.x, z: goal.y },
    tiles: tiles,
    solution_data: solutionData
  };

  fs.writeFileSync(filename, JSON.stringify(levelJson, null, 2), 'utf8');
}

function main() {
  // إنشاء خريطة بحجم 15x15
  const generator = new ProblemFirstGenerator(15, 15);
  
  const levelData = generator.generateLevel();
  
  printLevel(levelData);
  
  console.log(`\nطول المسار الذهبي (الحل الأساسي بدون الفخاخ): ${levelData.solutionLength} خطوة.`);

  // تصدير المرحلة إلى ملف JSON ليتم قراءته بواسطة المحاكي
  const outputFilename = 'generated_level.json';
  exportToJson(levelData, outputFilename);
  console.log(`\n✅ تم تصدير بيانات المرحلة بنجاح إلى ملف: ${outputFilename}`);
}

main();