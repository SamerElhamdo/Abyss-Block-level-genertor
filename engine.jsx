// =====================================================================
// ABYSS BLOCK — PROCEDURAL LEVEL ENGINE
// =====================================================================
// Block states:
//   "vertical"     -> standing on tile (x,z), occupies 1 cell
//   "horizontal-x" -> lying along X axis, occupies (x,z) and (x+1,z)
//   "horizontal-z" -> lying along Z axis, occupies (x,z) and (x,z+1)
// (x,z) is the "anchor" — the lower-coordinate cell when lying down.
// =====================================================================

// ---- Mulberry32 seeded RNG ------------------------------------------
function makeRNG(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Block movement primitives --------------------------------------
// Forward roll: from current state in direction d -> next state
// We need REVERSE: given current state, what previous state could roll FORWARD into it?
// For the Bloxorz block, forward and reverse are symmetric pairs of transitions.

// forward roll (used by simulator):
function rollForward(state, dir) {
  // state: {x, z, o}  o in {V, HX, HZ}
  // dir: "up"(-z), "down"(+z), "left"(-x), "right"(+x)
  const { x, z, o } = state;
  if (o === "V") {
    if (dir === "right") return { x: x + 1, z, o: "HX" };
    if (dir === "left")  return { x: x - 2, z, o: "HX" };
    if (dir === "down")  return { x, z: z + 1, o: "HZ" };
    if (dir === "up")    return { x, z: z - 2, o: "HZ" };
  } else if (o === "HX") {
    // occupies (x,z) and (x+1,z)
    if (dir === "right") return { x: x + 2, z, o: "V" };
    if (dir === "left")  return { x: x - 1, z, o: "V" };
    if (dir === "down")  return { x, z: z + 1, o: "HX" };
    if (dir === "up")    return { x, z: z - 1, o: "HX" };
  } else if (o === "HZ") {
    // occupies (x,z) and (x,z+1)
    if (dir === "right") return { x: x + 1, z, o: "HZ" };
    if (dir === "left")  return { x: x - 1, z, o: "HZ" };
    if (dir === "down")  return { x, z: z + 2, o: "V" };
    if (dir === "up")    return { x, z: z - 1, o: "V" };
  }
  return state;
}

// reverse roll: returns the PRIOR state that would roll forward into `state` via `dir`
// i.e. predecessor when forward-direction was `dir`
function rollReverse(state, dir) {
  // Apply rollForward with opposite direction's inverse mapping.
  // Easier: enumerate inverse mapping by flipping rules.
  const { x, z, o } = state;
  if (o === "V") {
    // came from HX (rolled right): prev was HX at (x-2, z)
    if (dir === "right") return { x: x - 2, z, o: "HX" };
    // came from HX (rolled left): prev was HX at (x+1, z)
    if (dir === "left")  return { x: x + 1, z, o: "HX" };
    if (dir === "down")  return { x, z: z - 2, o: "HZ" };
    if (dir === "up")    return { x, z: z + 1, o: "HZ" };
  } else if (o === "HX") {
    if (dir === "right") return { x: x - 1, z, o: "V" };
    if (dir === "left")  return { x: x + 2, z, o: "V" };
    if (dir === "down")  return { x, z: z - 1, o: "HX" };
    if (dir === "up")    return { x, z: z + 1, o: "HX" };
  } else if (o === "HZ") {
    if (dir === "right") return { x: x - 1, z, o: "HZ" };
    if (dir === "left")  return { x: x + 1, z, o: "HZ" };
    if (dir === "down")  return { x, z: z - 1, o: "V" };
    if (dir === "up")    return { x, z: z + 2, o: "V" };
  }
  return state;
}

// Cells occupied by a block in a given state
function cellsOf(state) {
  const { x, z, o } = state;
  if (o === "V") return [[x, z]];
  if (o === "HX") return [[x, z], [x + 1, z]];
  if (o === "HZ") return [[x, z], [x, z + 1]];
  return [[x, z]];
}

function stateKey(s) { return `${s.x},${s.z},${s.o}`; }

// ---- Stage A: Reverse Random Walk -----------------------------------
function generateGoldenPath(rng, steps, bounds) {
  // Hole at origin in grid coords -- we'll center the level later.
  // Start with vertical block at (0,0), reverse walk N steps.
  let cur = { x: 0, z: 0, o: "V" };
  const pathStates = [cur];        // index 0 = goal (hole) state
  const visitedKeys = new Set([stateKey(cur)]);
  // Track all visited cells (for collision avoidance during reverse walk)
  const visitedCells = new Map();  // "x,z" -> minIndex
  cellsOf(cur).forEach(([x, z]) => visitedCells.set(`${x},${z}`, 0));

  const dirs = ["up", "down", "left", "right"];

  for (let step = 0; step < steps; step++) {
    // shuffle dirs
    const order = [...dirs].sort(() => rng() - 0.5);
    let advanced = false;
    for (const d of order) {
      const prev = rollReverse(cur, d);
      const cells = cellsOf(prev);
      // bounds check
      if (!cells.every(([x, z]) =>
        x >= bounds.minX && x <= bounds.maxX &&
        z >= bounds.minZ && z <= bounds.maxZ)) continue;
      // avoid exact state revisit
      if (visitedKeys.has(stateKey(prev))) continue;
      cur = prev;
      pathStates.push(cur);
      visitedKeys.add(stateKey(cur));
      cells.forEach(([x, z]) => {
        const k = `${x},${z}`;
        if (!visitedCells.has(k)) visitedCells.set(k, pathStates.length - 1);
      });
      advanced = true;
      break;
    }
    if (!advanced) break;
  }

  // pathStates[length-1] is the START. pathStates[0] is the GOAL/HOLE.
  // Build the forward solution: from start to hole, the directions are
  // the reverse of the reverse-roll directions used. Easier: derive by
  // forward-rolling: for each consecutive pair (i+1 -> i) figure out dir.
  pathStates.reverse(); // now pathStates[0] = start, last = hole
  const solution = [];
  for (let i = 0; i < pathStates.length - 1; i++) {
    const a = pathStates[i], b = pathStates[i + 1];
    for (const d of dirs) {
      const r = rollForward(a, d);
      if (r.x === b.x && r.z === b.z && r.o === b.o) {
        solution.push(d);
        break;
      }
    }
  }
  return { pathStates, solution, visitedCells };
}

// ---- Stage B: Hazard injection --------------------------------------
function injectHazards(level, opts, rng) {
  const { pathStates } = level;
  const tilesByKey = new Map();   // "x,z" -> tile

  // First, every cell ever covered by the block becomes a Normal tile
  for (const s of pathStates) {
    for (const [x, z] of cellsOf(s)) {
      const k = `${x},${z}`;
      if (!tilesByKey.has(k)) tilesByKey.set(k, { x, z, type: "normal" });
    }
  }

  const goal = pathStates[pathStates.length - 1];
  const start = pathStates[0];
  const goalKey = `${goal.x},${goal.z}`;
  const startCells = cellsOf(start).map(([x, z]) => `${x},${z}`);

  // ---- Fragile tiles: cells where the block was lying horizontal but
  // never standing vertical. Those would break if you stand on them.
  if (opts.fragile) {
    const verticalCells = new Set();
    const horizontalCells = new Set();
    for (const s of pathStates) {
      for (const [x, z] of cellsOf(s)) {
        const k = `${x},${z}`;
        if (s.o === "V") verticalCells.add(k);
        else horizontalCells.add(k);
      }
    }
    for (const k of horizontalCells) {
      if (verticalCells.has(k)) continue;        // also vertical -> can't be fragile
      if (k === goalKey) continue;
      if (startCells.includes(k)) continue;
      const t = tilesByKey.get(k);
      if (t && rng() < 0.35) t.type = "fragile";
    }
  }

  // ---- Crumbling tiles: cells visited only once (no backtrack needed)
  if (opts.crumbling) {
    const visitCount = new Map();
    pathStates.forEach((s) => {
      for (const [x, z] of cellsOf(s)) {
        const k = `${x},${z}`;
        visitCount.set(k, (visitCount.get(k) || 0) + 1);
      }
    });
    for (const [k, count] of visitCount) {
      if (count > 1) continue;
      if (k === goalKey) continue;
      if (startCells.includes(k)) continue;
      const t = tilesByKey.get(k);
      if (!t || t.type !== "normal") continue;
      if (rng() < 0.18) t.type = "crumbling";
    }
  }

  // ---- Moving platforms: pick isolated normal cells along path
  // For simplicity place a few oscillating tiles parallel to path.
  if (opts.moving) {
    const candidates = [...tilesByKey.values()].filter(t =>
      t.type === "normal" &&
      `${t.x},${t.z}` !== goalKey &&
      !startCells.includes(`${t.x},${t.z}`)
    );
    const count = Math.min(3, Math.floor(candidates.length / 30));
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(rng() * candidates.length);
      const c = candidates.splice(idx, 1)[0];
      if (!c) break;
      c.type = "moving";
      const axis = rng() < 0.5 ? "x" : "z";
      const range = axis === "x"
        ? [c.x, c.x + 1 + Math.floor(rng() * 2)]
        : [c.z, c.z + 1 + Math.floor(rng() * 2)];
      c.params = { axis, range, speed: +(0.8 + rng() * 1.5).toFixed(2) };
    }
  }

  // ---- Wormhole portals: pair two distant normal tiles
  if (opts.portal) {
    const candidates = [...tilesByKey.values()].filter(t =>
      t.type === "normal" &&
      `${t.x},${t.z}` !== goalKey &&
      !startCells.includes(`${t.x},${t.z}`)
    );
    if (candidates.length >= 6) {
      const a = candidates.splice(Math.floor(rng() * candidates.length), 1)[0];
      // pick a far one
      candidates.sort((p, q) => {
        const dp = Math.hypot(p.x - a.x, p.z - a.z);
        const dq = Math.hypot(q.x - a.x, q.z - a.z);
        return dq - dp;
      });
      const b = candidates[0];
      a.type = "portal"; a.target = { x: b.x, z: b.z };
      b.type = "portal"; b.target = { x: a.x, z: a.z };
    }
  }

  return [...tilesByKey.values()];
}

// ---- Top-level builder -----------------------------------------------
function buildLevel({ difficulty = 5, seed = 42, mechanics = {}, gridSize = 40 }) {
  const rng = makeRNG(seed);
  const steps = 8 + difficulty * 6;             // 14 .. 68 steps
  const half = Math.floor(gridSize / 2);
  const bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
  const path = generateGoldenPath(rng, steps, bounds);
  const tiles = injectHazards(path, mechanics, rng);

  const start = path.pathStates[0];
  const goal = path.pathStates[path.pathStates.length - 1];

  return {
    level_metadata: {
      id: `lvl_${seed.toString(16)}_${Date.now().toString(36)}`,
      difficulty,
      seed,
      steps_to_solve: path.solution.length,
    },
    world_settings: { environment: "abyss_default", gravity: 1.0 },
    start_state: {
      pos: { x: start.x, z: start.z },
      orientation: start.o === "V" ? "vertical" : start.o === "HX" ? "horizontal-x" : "horizontal-z",
    },
    hole_pos: { x: goal.x, z: goal.z },
    tiles,
    solution_data: path.solution,
    _internal: { pathStates: path.pathStates },
  };
}

window.AbyssEngine = {
  makeRNG, rollForward, rollReverse, cellsOf, stateKey,
  generateGoldenPath, injectHazards, buildLevel,
};
