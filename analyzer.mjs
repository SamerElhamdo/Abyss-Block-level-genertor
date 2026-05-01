/**
 * Level Analyzer for Abyss Block
 * Evaluates level quality and provides metrics for refinement.
 */

import { simulateLevel, computeDifficultyScore, tileStats } from "./abyss-engine.mjs";

/**
 * analyzeLevel
 * @param {Object} level - The level data to analyze
 * @returns {Object} Analysis report
 */
export function analyzeLevel(level) {
  const sim = simulateLevel(level);
  const stats = tileStats(level);
  const diff = computeDifficultyScore(level);
  
  const moves = level.solution_data.length;
  const pathTiles = new Set();
  level.solution_data.forEach((_, i) => {
    // This is simplified, we just want to know how many tiles are actually in the grid
  });

  const totalTiles = level.tiles.length;
  const solutionTilesCount = moves; // Approximation
  const ambiguityScore = totalTiles / (solutionTilesCount || 1);

  // Check if fragile tiles are actually used by the block in horizontal orientation
  const fragileCount = level.tiles.filter(t => t.type === 'fragile').length;

  return {
    solvable: sim.ok,
    moves,
    difficulty_score: diff,
    ambiguity_score: ambiguityScore,
    is_linear: ambiguityScore < 1.2 && moves > 10,
    trivial: moves < 10,
    trap_density: stats.trap_density,
    reason: sim.reason || "ok"
  };
}
