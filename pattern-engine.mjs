/**
 * Pattern Engine for Abyss Block
 * Programmatically applies puzzle patterns to a golden path.
 */

import { cellsOf } from "./abyss-engine.mjs";

/**
 * applyPatterns
 * @param {Object} level - Level data (containing pathStates, solution)
 * @param {Array} patterns - List of patterns from Intent
 * @param {Object} rng - Random number generator
 */
export function applyPatterns(level, patterns, rng) {
  const { pathStates } = level;
  const tilesByKey = new Map();

  // Initialize all tiles from path as normal
  for (const s of pathStates) {
    for (const [x, z] of cellsOf(s)) {
      const k = `${x},${z}`;
      if (!tilesByKey.has(k)) {
        tilesByKey.set(k, { x, z, type: "normal" });
      }
    }
  }

  const goal = pathStates[pathStates.length - 1];
  const start = pathStates[0];
  const goalKey = `${goal.x},${goal.z}`;
  const startCells = cellsOf(start).map(([x, z]) => `${x},${z}`);

  for (const pattern of patterns) {
    switch (pattern.type) {
      case "fragile_bridge":
        applyFragileBridge(level, tilesByKey, pattern, goalKey, startCells, rng);
        break;
      case "crumbling_path":
        applyCrumblingPath(level, tilesByKey, pattern, goalKey, startCells, rng);
        break;
      case "narrow_pass":
        applyNarrowPass(level, tilesByKey, pattern, rng);
        break;
      case "pivot_point":
        applyPivotPoint(level, tilesByKey, pattern, rng);
        break;
      case "decoys":
        applyDecoys(level, tilesByKey, pattern, goalKey, startCells, rng);
        break;
    }
  }

  return [...tilesByKey.values()];
}

function applyDecoys(level, tilesByKey, pattern, goalKey, startCells, rng) {
  const { pathStates } = level;
  const numDecoys = pattern.count || 3;
  
  for (let d = 0; d < numDecoys; d++) {
    // Pick a random tile from the path to branch out from
    const baseState = pathStates[Math.floor(rng() * pathStates.length)];
    let cx = baseState.x, cz = baseState.z;
    
    // Add 2-4 tiles in a random direction
    const dir = [[1,0], [-1,0], [0,1], [0,-1]][Math.floor(rng() * 4)];
    for (let i = 1; i <= 3; i++) {
      cx += dir[0]; cz += dir[1];
      const k = `${cx},${cz}`;
      if (!tilesByKey.has(k) && k !== goalKey) {
        tilesByKey.set(k, { x: cx, z: cz, type: rng() < 0.3 ? "crumbling" : "normal" });
      }
    }
  }
}

function applyNarrowPass(level, tilesByKey, pattern, rng) {
  const { pathStates } = level;
  const length = pattern.length || 5;
  
  // Find a random start point for the narrow pass
  if (pathStates.length <= length) return;
  const startIdx = Math.floor(rng() * (pathStates.length - length));
  const segment = pathStates.slice(startIdx, startIdx + length);
  
  const essentialInSegment = new Set();
  segment.forEach(s => {
    cellsOf(s).forEach(([x, z]) => essentialInSegment.add(`${x},${z}`));
  });

  // Identify tiles within the bounding box of the segment that are NOT in essentialInSegment
  let minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
  essentialInSegment.forEach(k => {
    const [x, z] = k.split(',').map(Number);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  });

  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      const k = `${x},${z}`;
      if (!essentialInSegment.has(k)) {
        tilesByKey.delete(k);
      }
    }
  }
}

function applyPivotPoint(level, tilesByKey, pattern, rng) {
  const { pathStates } = level;
  // Find a state where the block is Vertical and ensure its tile is normal
  const vStates = pathStates.filter(s => s.o === "V");
  if (vStates.length > 0) {
    const pick = vStates[Math.floor(rng() * vStates.length)];
    const k = `${pick.x},${pick.z}`;
    const t = tilesByKey.get(k);
    if (t) t.type = "normal";
  }
}

function applyFragileBridge(level, tilesByKey, pattern, goalKey, startCells, rng) {
  const { pathStates } = level;
  const length = pattern.length || 3;
  
  // Find a horizontal segment in the path
  // A segment is horizontal if the orientation is 'HX' or 'HZ' for its duration
  for (let i = 0; i < pathStates.length - length; i++) {
    const segment = pathStates.slice(i, i + length);
    const isHorizontal = segment.every(s => s.o !== 'V');
    
    if (isHorizontal) {
      for (const s of segment) {
        for (const [x, z] of cellsOf(s)) {
          const k = `${x},${z}`;
          if (k === goalKey || startCells.includes(k)) continue;
          const t = tilesByKey.get(k);
          if (t) t.type = "fragile";
        }
      }
      if (pattern.forced) break; // Apply only once if forced
    }
  }
}

function applyCrumblingPath(level, tilesByKey, pattern, goalKey, startCells, rng) {
  const { pathStates } = level;
  
  // Identify single-visit tiles
  const visitCount = new Map();
  pathStates.forEach(s => {
    for (const [x, z] of cellsOf(s)) {
      const k = `${x},${z}`;
      visitCount.set(k, (visitCount.get(k) || 0) + 1);
    }
  });

  for (const [k, count] of visitCount) {
    if (count === 1 && k !== goalKey && !startCells.includes(k)) {
      const t = tilesByKey.get(k);
      if (t && t.type === "normal" && rng() < (pattern.probability || 0.5)) {
        t.type = "crumbling";
      }
    }
  }
}
