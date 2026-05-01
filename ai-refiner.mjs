/**
 * AI Refiner for Abyss Block
 * Manages the intent -> build -> analyze loop.
 */

import { makeRNG, generateGoldenPath, buildLevel, optimizeSolution, pruneUnreachableTiles, simulateLevel } from "./abyss-engine.mjs";
import { applyPatterns } from "./pattern-engine.mjs";
import { analyzeLevel } from "./analyzer.mjs";

export async function generateRefinedLevel(slot, phase, baseSeed, dirDeg, crossW, constraints) {
  const seed = hashSeed(baseSeed, slot);
  const rng = makeRNG(seed);
  
  let intent = generateInitialIntent(slot);
  let bestLevel = null;
  let bestAnalysis = null;

  for (let iteration = 0; iteration < 8; iteration++) { // More iterations for quality
    const level = buildFromIntent(intent, seed ^ (iteration * 123), dirDeg, crossW, constraints, rng);
    
    if (!level || level.solution_data.length === 0) continue;

    const analysis = analyzeLevel(level);
    
    if (analysis.solvable && analysis.moves >= (intent.constraints.min_moves || 5)) {
      // Prioritize levels that are NOT linear
      if (!analysis.is_linear || slot <= 10) {
        if (!bestLevel || analysis.difficulty_score > (bestAnalysis ? bestAnalysis.difficulty_score : 0)) {
          bestLevel = level;
          bestAnalysis = analysis;
        }

        if (analysis.difficulty_score >= intent.target_difficulty && !analysis.is_linear) break;
      }
    }

    intent = refineIntent(intent, analysis, rng);
  }

  return bestLevel ? { lvl: bestLevel, verified: true } : null;
}

function generateInitialIntent(slot) {
  if (slot <= 10) {
    const decoys = slot > 5 ? [{ type: "decoys", count: 2 }] : [];
    if (slot <= 2) return {
      goal: "tutorial", target_difficulty: 1, patterns: [...decoys], constraints: { min_moves: 8 }, mechanics: {},
      objective: "Reach the goal hole by rolling the block. Master the basics of movement."
    };
    if (slot <= 4) return {
      goal: "tutorial_fragile", target_difficulty: 2, patterns: [{ type: "fragile_bridge", length: 2, forced: true }, ...decoys], constraints: { min_moves: 10 }, mechanics: { fragile: true },
      objective: "Careful! Fragile tiles will collapse if you stand vertically on them."
    };
    if (slot <= 6) return {
      goal: "tutorial_crumbling", target_difficulty: 2, patterns: [{ type: "crumbling_path", probability: 0.5 }, ...decoys], constraints: { min_moves: 12 }, mechanics: { crumbling: true },
      objective: "Watch your step. Crumbling tiles disappear forever after a single visit."
    };
    if (slot <= 8) return {
      goal: "tutorial_moving", target_difficulty: 3, patterns: [{ type: "pivot_point" }, ...decoys], constraints: { min_moves: 15 }, mechanics: { moving: true },
      objective: "Timing is everything. Use the moving platforms to cross the void."
    };
    return {
      goal: "tutorial_portal", target_difficulty: 4, patterns: [{ type: "narrow_pass" }, ...decoys], constraints: { min_moves: 18 }, mechanics: { portal: true },
      objective: "Dimensional jump! Use portals to travel between isolated islands."
    };
  }

  const progress = (slot - 11) / 89;
  const abyssObjectives = [
    "Navigate through a complex maze of hazards to find the exit.",
    "The abyss is shifting. Combine all your skills to survive this challenge.",
    "A master-level puzzle. Every move must be calculated to reach the goal.",
    "Bridge the gaps and avoid the traps. The ultimate test of logic.",
    "Extreme difficulty detected. Only the most precise movements will succeed."
  ];

  return {
    goal: "abyss_mix",
    target_difficulty: 6 + (progress * 4),
    patterns: [
      { type: "fragile_bridge", length: 3, forced: true },
      { type: "crumbling_path", probability: 0.5 },
      { type: "narrow_pass", length: 6 },
      { type: "pivot_point" },
      { type: "decoys", count: 3 + Math.floor(progress * 5) }
    ],
    constraints: { min_moves: 35 + (progress * 45) },
    mechanics: { fragile: true, crumbling: true, moving: true, portal: true },
    objective: abyssObjectives[Math.floor(progress * abyssObjectives.length)]
  };
}

function buildFromIntent(intent, seed, dirDeg, crossW, constraints, rng) {
  // ... (previous logic for expansionOpts, steps, gridSize, bounds)
  const expansionOpts = {
    dirAngleDeg: dirDeg,
    spreadDeg: 130,
    deviationPct: 0.25,
    crossAxisLimit: crossW + 1
  };

  const steps = Math.max(20, 10 + (intent.target_difficulty || 5) * 8);
  const gridSize = 60;
  const half = Math.floor(gridSize / 2);
  const bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };

  let path;
  for (let pTry = 0; pTry < 5; pTry++) {
    path = generateGoldenPath(makeRNG(seed ^ (pTry * 999)), steps, bounds, expansionOpts);
    if (path.solution.length >= (intent.constraints.min_moves || 8)) break;
  }
  
  if (!path || path.solution.length === 0) return null;

  const mech = {
    fragile: intent.mechanics.fragile || false,
    crumbling: intent.mechanics.crumbling || false,
    moving: intent.mechanics.moving || false,
    portal: intent.mechanics.portal || false,
    fragileRate: 0.35,
    crumblingRate: 0.20
  };

  const tiles = applyPatterns(path, intent.patterns, rng);

  const start = path.pathStates[0];
  const goal = path.pathStates[path.pathStates.length - 1];

  const level = {
    level_metadata: {
      id: `lvl_${seed.toString(16)}`,
      difficulty: intent.target_difficulty,
      objective: intent.objective, // Adding the objective here
      seed,
      steps_to_solve: path.solution.length,
      map_bounds: path.mapBounds,
      layout_dir: `${dirDeg}deg`
    },
    world_settings: { environment: "abyss_default", gravity: 1.0 },
    start_state: {
      pos: { x: start.x, z: start.z },
      orientation: start.o === "V" ? "vertical" : start.o === "HX" ? "horizontal-x" : "horizontal-z",
    },
    hole_pos: { x: goal.x, z: goal.z },
    tiles,
    solution_data: path.solution,
    _internal: { pathStates: path.pathStates }
  };

  const sim = simulateLevel(level);
  if (!sim.ok) return null;

  const optimized = optimizeSolution(level);
  if (optimized.solution_data.length === 0) return null;

  return pruneUnreachableTiles(optimized);
}


function refineIntent(intent, analysis, rng) {
  const newIntent = JSON.parse(JSON.stringify(intent));
  
  if (!analysis.solvable) {
    // If not solvable, maybe too many patterns? Reduce them.
    if (newIntent.patterns.length > 0) {
      newIntent.patterns.pop();
    }
  } else if (analysis.difficulty_score < intent.target_difficulty) {
    // Too easy? Increase pattern intensity or add a new one.
    if (newIntent.patterns.length < 3) {
      newIntent.patterns.push({ type: "fragile_bridge", length: 3, forced: false });
    }
  }

  return newIntent;
}

function hashSeed(base, slot) {
  let x = ((base >>> 0) ^ (slot * 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x ^= x >>> 15;
  return x >>> 0;
}
