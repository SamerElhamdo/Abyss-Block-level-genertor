/**
 * Puzzle Pattern Library — Abyss Block
 *
 * Patterns are small, reusable puzzle building blocks that can be "stamped"
 * onto a generated level to guarantee specific behavioral interactions.
 *
 * Each pattern has:
 *   fit(pathStates, index, context) → boolean  — can this pattern apply here?
 *   apply(tileMap, pathStates, index)           — mutates tileMap in place
 *   difficulty_contribution                      — approx score increase
 *
 * Usage:
 *   import { applyPatterns } from './puzzle-patterns.mjs';
 *   const modified = applyPatterns(level, ['FRAGILE_BRIDGE', 'ONE_TIME_PATH'], rng);
 *   // then re-verify with simulateLevel(modified)
 */

import { cellsOf } from '../abyss-engine.mjs';

// ---- Helpers -------------------------------------------------------

function tileKey(x, z) { return `${x},${z}`; }

function isGoalOrStart(pathStates, index) {
  const s = pathStates[index];
  const k = tileKey(s.x, s.z);
  const startCells = cellsOf(pathStates[0]).map(([x, z]) => tileKey(x, z));
  const goalCells  = cellsOf(pathStates[pathStates.length - 1]).map(([x, z]) => tileKey(x, z));
  return startCells.includes(k) || goalCells.includes(k);
}

// Count how many times each cell is visited in pathStates
function buildVisitCount(pathStates) {
  const counts = new Map();
  for (const s of pathStates) {
    for (const [x, z] of cellsOf(s)) {
      const k = tileKey(x, z);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return counts;
}

// ---- Pattern Definitions -------------------------------------------

export const PATTERNS = {

  /**
   * FRAGILE_BRIDGE
   * Normal → Fragile → Normal
   * Player must approach and leave horizontally — cannot roll vertically over this tile.
   * Fits on any state where the block is horizontal (HX/HZ) and not start/goal.
   */
  FRAGILE_BRIDGE: {
    name: 'FRAGILE_BRIDGE',
    difficulty_contribution: 1.5,
    fit(pathStates, index) {
      if (index <= 0 || index >= pathStates.length - 1) return false;
      if (isGoalOrStart(pathStates, index)) return false;
      const s = pathStates[index];
      // Must be horizontal and never stepped on vertically
      return s.o === 'HX' || s.o === 'HZ';
    },
    apply(tileMap, pathStates, index) {
      const s = pathStates[index];
      // Mark the primary cell of this state as fragile
      const k = tileKey(s.x, s.z);
      const tile = tileMap.get(k);
      if (tile && tile.type === 'normal') tile.type = 'fragile';
    },
  },

  /**
   * ONE_TIME_PATH
   * Normal → Crumbling → Normal
   * Tile disappears after first visit — player cannot return along this path.
   * Fits on any single-visit tile that is not start/goal.
   */
  ONE_TIME_PATH: {
    name: 'ONE_TIME_PATH',
    difficulty_contribution: 1.0,
    fit(pathStates, index, context) {
      if (isGoalOrStart(pathStates, index)) return false;
      const s = pathStates[index];
      const k = tileKey(s.x, s.z);
      return (context.visitCount.get(k) || 0) === 1;
    },
    apply(tileMap, pathStates, index) {
      const s = pathStates[index];
      const k = tileKey(s.x, s.z);
      const tile = tileMap.get(k);
      if (tile && tile.type === 'normal') tile.type = 'crumbling';
    },
  },

  /**
   * PRECISION_CORRIDOR
   * A consecutive run of 3+ horizontal states → all marked fragile.
   * Player must maintain horizontal orientation throughout the corridor.
   * Fits at the START index of a run of at least 3 consecutive HX/HZ states.
   */
  PRECISION_CORRIDOR: {
    name: 'PRECISION_CORRIDOR',
    difficulty_contribution: 2.0,
    minLength: 3,
    fit(pathStates, index) {
      if (index <= 0) return false;
      let run = 0;
      for (let j = index; j < pathStates.length - 1; j++) {
        const o = pathStates[j].o;
        if (o === 'HX' || o === 'HZ') run++;
        else break;
      }
      return run >= 3 && !isGoalOrStart(pathStates, index);
    },
    apply(tileMap, pathStates, index) {
      for (let j = index; j < pathStates.length - 1; j++) {
        const s = pathStates[j];
        if (s.o !== 'HX' && s.o !== 'HZ') break;
        const k = tileKey(s.x, s.z);
        const tile = tileMap.get(k);
        if (tile && tile.type === 'normal') tile.type = 'fragile';
      }
    },
  },

  /**
   * ALIGNMENT_APPROACH
   * Marks the tile just before a fragile tile as normal (safe maneuver zone).
   * Ensures there is space for the player to re-orient before the fragile crossing.
   * This is more of a "guarantee" pattern — ensures the approach is not itself fragile.
   */
  ALIGNMENT_APPROACH: {
    name: 'ALIGNMENT_APPROACH',
    difficulty_contribution: 0.5,
    fit(pathStates, index, context) {
      if (index <= 0 || index >= pathStates.length - 2) return false;
      if (isGoalOrStart(pathStates, index)) return false;
      // Fits when next state is a fragile tile (already set)
      const next = pathStates[index + 1];
      const k = tileKey(next.x, next.z);
      return context.tileMap.get(k)?.type === 'fragile';
    },
    apply(tileMap, pathStates, index) {
      // Ensure the current approach tile is NOT fragile (safe maneuver zone)
      const s = pathStates[index];
      const k = tileKey(s.x, s.z);
      const tile = tileMap.get(k);
      if (tile && tile.type === 'fragile') tile.type = 'normal';
    },
  },

};

// ---- Pattern Applicator --------------------------------------------

/**
 * Apply a list of patterns to a level.
 * Requires level._internal.pathStates to be present (before _internal is stripped).
 *
 * @param {object} level   - Level object with tiles and _internal.pathStates
 * @param {string[]} names - Pattern names to apply (from PATTERNS keys)
 * @param {function} rng   - RNG function from makeRNG
 * @returns {object}       - Modified level (tiles mutated in place, _internal updated)
 */
export function applyPatterns(level, names, rng) {
  if (!level._internal?.pathStates) return level;

  const pathStates  = level._internal.pathStates;
  // Clone tiles so we never mutate the caller's level
  const tileMap     = new Map(level.tiles.map(t => [tileKey(t.x, t.z), { ...t }]));
  const visitCount  = buildVisitCount(pathStates);
  const context     = { visitCount, tileMap };
  const applied     = [];

  for (const name of names) {
    const pattern = PATTERNS[name];
    if (!pattern) continue;

    // Collect all fitting positions
    const candidates = [];
    for (let i = 1; i < pathStates.length - 1; i++) {
      if (pattern.fit(pathStates, i, context)) candidates.push(i);
    }
    if (candidates.length === 0) continue;

    // Shuffle candidates and apply to the first match
    candidates.sort(() => rng() - 0.5);
    const chosen = candidates[0];
    pattern.apply(tileMap, pathStates, chosen);
    applied.push({ pattern: name, index: chosen });
  }

  // Rebuild tiles array from tileMap (preserves order and params)
  const updatedTiles = level.tiles.map(t => tileMap.get(tileKey(t.x, t.z)) || t);

  return {
    ...level,
    tiles: updatedTiles,
    _internal: {
      ...level._internal,
      appliedPatterns: applied,
    },
  };
}
