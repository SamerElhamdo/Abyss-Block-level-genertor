/**
 * Gemini Quality Validator
 * Checks for: Solvability, Minimum Complexity, and Non-Linearity.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { simulateLevel, optimizeSolution, tileStats } from "../abyss-engine.mjs";

export async function verifyLevelQuality(levelData) {
  const sim = simulateLevel(levelData);
  if (!sim.ok) return { ok: false, reason: `Unsolvable: ${sim.reason}` };

  const stats = tileStats(levelData);
  const solution = levelData.solution_data;
  const moves = solution.length;

  // Rule 1: No trivial levels (must be > 20 moves for Special levels)
  if (moves < 25) return { ok: false, reason: `Too trivial: only ${moves} moves.` };

  // Rule 2: Minimum Trap Density
  if (stats.trap_density < 0.15) return { ok: false, reason: "Too boring: low trap density." };

  // Rule 3: Orientation Diversity
  // Check if the solution requires moving in many directions, not just one straight line
  const dirCounts = { up: 0, down: 0, left: 0, right: 0 };
  solution.forEach(d => dirCounts[d]++);
  const activeDirs = Object.values(dirCounts).filter(c => c > 0).length;
  if (activeDirs < 3) return { ok: false, reason: "Too linear: moves in too few directions." };

  return { ok: true, score: moves + (stats.trap_density * 10) };
}

// If run directly
if (process.argv[1].endsWith('verify-quality.mjs')) {
    const filePath = process.argv[2];
    if (filePath) {
        const data = JSON.parse(await fs.readFile(filePath, "utf8"));
        const report = await verifyLevelQuality(data);
        console.log(JSON.stringify(report, null, 2));
    }
}
