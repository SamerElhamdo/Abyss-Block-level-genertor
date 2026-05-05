/**
 * Shared generation logic — used by generate-all.mjs and generate-variants.mjs.
 * Centralises phase templates, helpers, and the scored-candidate pipeline.
 */

import {
  buildLevelVerified,
  simulateLevel,
  pruneUnreachableTiles,
  optimizeSolution,
  computeCriticalTiles,
  computeBehavioralMetrics,
  computeEvolutionFitness,
  tileStats,
  makeRNG,
} from '../abyss-engine.mjs';
import { applyPatterns } from './puzzle-patterns.mjs';

// ── helpers ──────────────────────────────────────────────────────────
export function lerp(a, b, t)      { return a + (b - a) * t; }
export function lerpRound(a, b, t) { return Math.round(lerp(a, b, t)); }
export function phaseT(i, n)       { return n <= 1 ? 1 : i / (n - 1); }
export function evenGrid(n)        { return n % 2 === 0 ? n : n - 1; }

export function hashSeed(base, slot) {
  let x = ((base >>> 0) ^ (slot * 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x ^= x >>> 15;
  return x >>> 0;
}

// ── weighted distribution ────────────────────────────────────────────
export function distributeWeighted(total, weights) {
  const sum    = weights.reduce((a, b) => a + b, 0);
  const raw    = weights.map(w => (w / sum) * total);
  const counts = raw.map(Math.floor);
  let rem = total - counts.reduce((a, b) => a + b, 0);

  raw.map((r, i) => ({ i, f: r - Math.floor(r) }))
     .sort((a, b) => b.f - a.f)
     .slice(0, rem)
     .forEach(({ i }) => counts[i]++);

  const active = Math.min(weights.length, total);
  for (let i = 0; i < active; i++) {
    if (counts[i] === 0) {
      const maxIdx = counts.reduce((mi, c, ci) => c > counts[mi] ? ci : mi, 0);
      if (counts[maxIdx] > 1) { counts[maxIdx]--; counts[i]++; }
    }
  }
  return counts;
}

// ── map bounds (includes moving tile oscillation range) ───────────────
export function recomputeMapBounds(data) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of data.tiles) {
    if (t.type === 'moving' && t.params) {
      const { axis, range } = t.params;
      if (axis === 'x') {
        minX = Math.min(minX, range[0]); maxX = Math.max(maxX, range[1]);
        minZ = Math.min(minZ, t.z);      maxZ = Math.max(maxZ, t.z);
      } else {
        minX = Math.min(minX, t.x);      maxX = Math.max(maxX, t.x);
        minZ = Math.min(minZ, range[0]); maxZ = Math.max(maxZ, range[1]);
      }
    } else {
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minZ = Math.min(minZ, t.z); maxZ = Math.max(maxZ, t.z);
    }
  }
  if (!isFinite(minX)) return data.level_metadata?.map_bounds ?? null;
  return { minX, maxX, minZ, maxZ, width: maxX - minX + 1, length: maxZ - minZ + 1 };
}

// ── target-guided selection score ─────────────────────────────────────
// fitness × (FLOOR + (1-FLOOR) × Gaussian_proximity)
export const SELECTION_FLOOR = 0.25;
export function selectionScore(fitness, computedDifficulty, targetDifficulty, sigma) {
  const d         = computedDifficulty - targetDifficulty;
  const proximity = Math.exp(-(d * d) / (2 * sigma * sigma));
  return fitness * (SELECTION_FLOOR + (1 - SELECTION_FLOOR) * proximity);
}

// ── difficulty targets (linear ramp) ──────────────────────────────────
export function computeTargets(levelCount, diffMin, diffMax) {
  return Array.from({ length: levelCount }, (_, i) =>
    +lerp(diffMin, diffMax, levelCount <= 1 ? 1 : i / (levelCount - 1)).toFixed(3)
  );
}

// ── phase templates ───────────────────────────────────────────────────
// Trap rates calibrated so candidates naturally produce ≤3 traps per type.
// Hard caps (maxFragile/maxCrumbling) enforce the ≤3 rule at selection time.
// minBFSMoves lowered to match the now-correct crumbling-aware BFS optimal paths.
export const PHASE_TEMPLATES = [

  // ── Hard Start ──────────────────────────────────────────────────
  {
    label: 'hard_start', weight: 25,
    constraints: { minMoves: 20, maxMoves: 50, minBFSMoves: 8, maxFragile: 3, maxCrumbling: 2 },
    maxAttempts: 60,
    fn(i, count, seed, dirDeg, crossW) {
      const ti = phaseT(i, count);
      return {
        seed,
        difficulty:  lerpRound(4, 6, ti),
        gridSize:    evenGrid(lerpRound(16, 22, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: false, portal: false,
          fragileRate:    +lerp(0.15, 0.25, ti).toFixed(3),
          crumblingRate:  +lerp(0.08, 0.15, ti).toFixed(3),
          constraintMode: true,
        },
        patterns:  ['FRAGILE_BRIDGE', 'ONE_TIME_PATH'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      90,
          deviationPct:   0.18,
          crossAxisLimit: Math.max(2, crossW - 1),
        },
      };
    },
  },

  // ── Precision ───────────────────────────────────────────────────
  {
    label: 'precision', weight: 25,
    constraints: { minMoves: 28, maxMoves: 58, minBFSMoves: 12, maxFragile: 3, maxCrumbling: 3 },
    maxAttempts: 70,
    fn(i, count, seed, dirDeg, crossW) {
      const ti = phaseT(i, count);
      return {
        seed,
        difficulty:  lerpRound(5, 7, ti),
        gridSize:    evenGrid(lerpRound(20, 28, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: false, portal: false,
          fragileRate:    +lerp(0.15, 0.22, ti).toFixed(3),
          crumblingRate:  +lerp(0.08, 0.15, ti).toFixed(3),
          constraintMode: true,
        },
        patterns:  ['FRAGILE_BRIDGE', 'ONE_TIME_PATH', 'PRECISION_CORRIDOR'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      80,
          deviationPct:   0.12,
          crossAxisLimit: Math.max(2, crossW - 1),
        },
      };
    },
  },

  // ── Moving ──────────────────────────────────────────────────────
  {
    label: 'moving', weight: 25,
    constraints: { minMoves: 38, maxMoves: 68, minBFSMoves: 16, maxFragile: 3, maxCrumbling: 3 },
    maxAttempts: 250,
    fn(i, count, seed, dirDeg, crossW) {
      const ti = phaseT(i, count);
      return {
        seed,
        difficulty:  lerpRound(6, 9, ti),
        gridSize:    evenGrid(lerpRound(26, 34, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: true, portal: false,
          fragileRate:    +lerp(0.12, 0.18, ti).toFixed(3),
          crumblingRate:  +lerp(0.06, 0.12, ti).toFixed(3),
          constraintMode: true,
        },
        patterns:  ['FRAGILE_BRIDGE', 'ONE_TIME_PATH', 'PRECISION_CORRIDOR'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      75,   // تضييق المسار لتقليل الاختصارات
          deviationPct:   0.12,
          crossAxisLimit: Math.max(2, crossW - 1),
        },
      };
    },
  },

  // ── Islands ─────────────────────────────────────────────────────
  {
    label: 'islands', weight: 15,
    constraints: { minMoves: 24, maxMoves: 68, minBFSMoves: 10, maxFragile: 3, maxCrumbling: 2 },
    maxAttempts: 150,
    fn(i, count, seed, dirDeg, crossW) {
      const ti = phaseT(i, count);
      return {
        seed,
        difficulty:  lerpRound(7, 9, ti),
        gridSize:    evenGrid(lerpRound(28, 36, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: false, portal: true,
          fragileRate:    +lerp(0.10, 0.18, ti).toFixed(3),
          crumblingRate:  +lerp(0.05, 0.10, ti).toFixed(3),
          constraintMode: true,
        },
        patterns:  ['FRAGILE_BRIDGE', 'ONE_TIME_PATH'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      65,
          deviationPct:   0.12,
          crossAxisLimit: crossW,
        },
      };
    },
  },

  // ── Abyss ───────────────────────────────────────────────────────
  {
    label: 'abyss', weight: 10,
    constraints: { minMoves: 35, maxMoves: 85, minBFSMoves: 10, maxFragile: 3, maxCrumbling: 3 },
    maxAttempts: 300,
    fn(i, count, seed, dirDeg, crossW) {
      const ti = phaseT(i, count);
      return {
        seed,
        difficulty:  lerpRound(9, 10, ti),
        gridSize:    evenGrid(lerpRound(34, 40, ti)),
        mechanics: {
          fragile: true, crumbling: true, moving: true, portal: true,
          fragileRate:    +lerp(0.10, 0.14, ti).toFixed(3),
          crumblingRate:  +lerp(0.05, 0.09, ti).toFixed(3),
          constraintMode: true,
        },
        patterns:  ['FRAGILE_BRIDGE', 'ONE_TIME_PATH', 'PRECISION_CORRIDOR'],
        expansionOpts: {
          dirAngleDeg:    dirDeg,
          spreadDeg:      85,
          deviationPct:   0.15,
          crossAxisLimit: crossW + 1,
        },
      };
    },
  },
];

// ── build phases from LEVEL_COUNT ─────────────────────────────────────
export function buildPhases(levelCount) {
  const weights = PHASE_TEMPLATES.map(t => t.weight);
  const counts  = distributeWeighted(levelCount, weights);
  let fromSlot = 1;
  return PHASE_TEMPLATES
    .map((tmpl, i) => {
      const count = counts[i];
      const from  = fromSlot;
      fromSlot   += count;
      return { ...tmpl, from, count };
    })
    .filter(p => p.count > 0);
}

// ── double-check before writing ───────────────────────────────────────
export function doubleCheck(clean) {
  const required = ['level_metadata', 'start_state', 'hole_pos', 'tiles', 'solution_data'];
  for (const k of required) {
    if (!(k in clean)) return { ok: false, reason: `missing field: ${k}` };
  }
  if (!Array.isArray(clean.tiles) || clean.tiles.length === 0)
    return { ok: false, reason: 'empty tiles array' };
  if (!Array.isArray(clean.solution_data) || clean.solution_data.length === 0)
    return { ok: false, reason: 'empty solution_data' };

  const sim = simulateLevel(clean);
  if (!sim.ok) return { ok: false, reason: `sim fail step=${sim.step} ${sim.reason}` };

  const mb = clean.level_metadata?.map_bounds;
  if (mb) {
    for (const t of clean.tiles) {
      if (t.type === 'moving') continue;
      if (t.x < mb.minX || t.x > mb.maxX || t.z < mb.minZ || t.z > mb.maxZ)
        return { ok: false, reason: `tile (${t.x},${t.z}) outside map_bounds` };
    }
  }

  // Isolation check: no non-goal tile should be completely disconnected.
  // Moving tiles count for all positions in their oscillation range.
  const tileSet = new Set();
  for (const t of clean.tiles) {
    if (t.type === 'moving' && t.params) {
      const { axis, range } = t.params;
      for (let pos = range[0]; pos <= range[1]; pos++) {
        if (axis === 'x') tileSet.add(`${pos},${t.z}`);
        else tileSet.add(`${t.x},${pos}`);
      }
    } else {
      tileSet.add(`${t.x},${t.z}`);
    }
  }
  const goalKey = `${clean.hole_pos.x},${clean.hole_pos.z}`;
  for (const t of clean.tiles) {
    if (t.type === 'moving') continue;
    if (`${t.x},${t.z}` === goalKey) continue;
    const hasNeighbor =
      tileSet.has(`${t.x + 1},${t.z}`) || tileSet.has(`${t.x - 1},${t.z}`) ||
      tileSet.has(`${t.x},${t.z + 1}`) || tileSet.has(`${t.x},${t.z - 1}`);
    if (!hasNeighbor) return { ok: false, reason: `isolated tile at (${t.x},${t.z})` };
  }

  return { ok: true };
}

// ── single candidate pipeline ─────────────────────────────────────────
const PAT_XOR = 0xbeef_cafe;

export function buildScoredCandidate(slot, evoSeed, phase, phaseIdx, dirDeg, crossW) {
  const args = phase.fn(phaseIdx, phase.count, evoSeed, dirDeg, crossW);
  const { lvl, attempts, verified } = buildLevelVerified(
    args, phase.constraints, phase.maxAttempts
  );
  if (!lvl) return null;

  // For fallback (unverified): manually apply BFS + minBFSMoves check
  let workLvl = lvl;
  if (!verified) {
    const pruned = pruneUnreachableTiles(lvl);
    const bfs    = optimizeSolution(pruned);
    if (!simulateLevel(bfs).ok) return null;
    if (bfs.solution_data.length < (phase.constraints.minBFSMoves ?? 0)) return null;
    workLvl = bfs;
  }

  // Apply puzzle patterns
  let finalLvl = workLvl;
  const patternsToApply = args.patterns ?? [];
  if (patternsToApply.length > 0 && workLvl._internal?.pathStates) {
    const patRng      = makeRNG(hashSeed(PAT_XOR ^ evoSeed, slot));
    const candidate   = applyPatterns(workLvl, patternsToApply, patRng);
    // Prune after patterns to remove any orphaned tiles they may introduce
    const patPruned   = pruneUnreachableTiles(candidate);
    if (simulateLevel(patPruned).ok) finalLvl = patPruned;
  }

  const { _internal, ...optimized } = finalLvl;

  // Correct map bounds to include moving tile oscillation range
  const correctedBounds = recomputeMapBounds(optimized);
  if (correctedBounds) {
    optimized.level_metadata = { ...optimized.level_metadata, map_bounds: correctedBounds };
  }

  const movesAfterOpt = optimized.solution_data.length;
  const stats         = tileStats(optimized);

  // Hard cap: reject candidates with too many traps (≤3 per type)
  const { maxFragile = Infinity, maxCrumbling = Infinity, maxMoving = Infinity } = phase.constraints;
  if (stats.fragile > maxFragile || stats.crumbling > maxCrumbling || stats.moving > maxMoving) {
    return null;
  }

  const criticalTiles = computeCriticalTiles(optimized);
  const metrics       = computeBehavioralMetrics(optimized, criticalTiles);
  const score         = metrics.behavioral_difficulty;
  const fitness       = computeEvolutionFitness(optimized, criticalTiles, metrics);

  return {
    finalLvl, _internal, optimized, args,
    metrics, stats, criticalTiles,
    attempts, verified, score, fitness, movesAfterOpt,
  };
}
