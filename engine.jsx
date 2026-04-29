// =====================================================================
// ABYSS BLOCK — PROCEDURAL LEVEL ENGINE
// =====================================================================
// Block states:
//   "vertical"     -> standing on tile (x,z), occupies 1 cell
//   "horizontal-x" -> lying along X axis, occupies (x,z) and (x+1,z)
//   "horizontal-z" -> lying along Z axis, occupies (x,z) and (x,z+1)
// (x,z) is the "anchor" — the lower-coordinate cell when lying down.
// =====================================================================

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

function rollForward(state, dir) {
  const { x, z, o } = state;
  if (o === "V") {
    if (dir === "right") return { x: x + 1, z, o: "HX" };
    if (dir === "left")  return { x: x - 2, z, o: "HX" };
    if (dir === "down")  return { x, z: z + 1, o: "HZ" };
    if (dir === "up")    return { x, z: z - 2, o: "HZ" };
  } else if (o === "HX") {
    if (dir === "right") return { x: x + 2, z, o: "V" };
    if (dir === "left")  return { x: x - 1, z, o: "V" };
    if (dir === "down")  return { x, z: z + 1, o: "HX" };
    if (dir === "up")    return { x, z: z - 1, o: "HX" };
  } else if (o === "HZ") {
    if (dir === "right") return { x: x + 1, z, o: "HZ" };
    if (dir === "left")  return { x: x - 1, z, o: "HZ" };
    if (dir === "down")  return { x, z: z + 2, o: "V" };
    if (dir === "up")    return { x, z: z - 1, o: "V" };
  }
  return state;
}

function rollReverse(state, dir) {
  const { x, z, o } = state;
  if (o === "V") {
    if (dir === "right") return { x: x - 2, z, o: "HX" };
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

function cellsOf(state) {
  const { x, z, o } = state;
  if (o === "V")  return [[x, z]];
  if (o === "HX") return [[x, z], [x + 1, z]];
  if (o === "HZ") return [[x, z], [x, z + 1]];
  return [[x, z]];
}

function stateKey(s) { return `${s.x},${s.z},${s.o}`; }

// ---- Stage A: Reverse Random Walk -----------------------------------
// expansionOpts: { directions: ["north"|"east"|"south"|"west"], spreadDeg: number }
// Constrains the walk to a directional cone centered at the goal (origin).
// directions is an array of 0–2 cardinal strings; spreadDeg is the TOTAL cone width.
function generateGoldenPath(rng, steps, bounds, expansionOpts = {}) {
  const { directions = [], spreadDeg = 360 } = expansionOpts;

  // atan2(z, x) coordinate space: east=0, south=PI/2, west=±PI, north=-PI/2
  const DIR_ANGLE = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 };
  const halfSpread = (spreadDeg / 2) * (Math.PI / 180);
  const centers = directions.map(d => DIR_ANGLE[d]).filter(a => a !== undefined);

  function isAllowedPos(x, z) {
    if (centers.length === 0) return true;
    if (x === 0 && z === 0) return true;
    const angle = Math.atan2(z, x);
    return centers.some(c => {
      let diff = angle - c;
      while (diff >  Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      return Math.abs(diff) <= halfSpread;
    });
  }

  let cur = { x: 0, z: 0, o: "V" };
  const pathStates = [cur];
  const visitedKeys = new Set([stateKey(cur)]);
  const visitedCells = new Map();
  cellsOf(cur).forEach(([x, z]) => visitedCells.set(`${x},${z}`, 0));

  const dirs = ["up", "down", "left", "right"];

  for (let step = 0; step < steps; step++) {
    const order = [...dirs].sort(() => rng() - 0.5);
    let advanced = false;
    for (const d of order) {
      const prev = rollReverse(cur, d);
      const cells = cellsOf(prev);
      if (!cells.every(([x, z]) =>
        x >= bounds.minX && x <= bounds.maxX &&
        z >= bounds.minZ && z <= bounds.maxZ)) continue;
      if (visitedKeys.has(stateKey(prev))) continue;
      if (!cells.every(([x, z]) => isAllowedPos(x, z))) continue;
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

  pathStates.reverse();
  const solution = [];
  for (let i = 0; i < pathStates.length - 1; i++) {
    const a = pathStates[i], b = pathStates[i + 1];
    for (const d of dirs) {
      const r = rollForward(a, d);
      if (r.x === b.x && r.z === b.z && r.o === b.o) { solution.push(d); break; }
    }
  }
  return { pathStates, solution, visitedCells };
}

// ---- Stage B: Hazard injection --------------------------------------
function injectHazards(level, opts, rng) {
  const { pathStates } = level;
  const tilesByKey = new Map();

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

  if (opts.fragile) {
    const verticalCells = new Set();
    const horizontalCells = new Set();
    for (const s of pathStates) {
      for (const [x, z] of cellsOf(s)) {
        const k = `${x},${z}`;
        if (s.o === "V") verticalCells.add(k); else horizontalCells.add(k);
      }
    }
    for (const k of horizontalCells) {
      if (verticalCells.has(k)) continue;
      if (k === goalKey || startCells.includes(k)) continue;
      const t = tilesByKey.get(k);
      if (t && rng() < 0.35) t.type = "fragile";
    }
  }

  if (opts.crumbling) {
    const visitCount = new Map();
    pathStates.forEach(s => {
      for (const [x, z] of cellsOf(s)) {
        const k = `${x},${z}`;
        visitCount.set(k, (visitCount.get(k) || 0) + 1);
      }
    });
    for (const [k, count] of visitCount) {
      if (count > 1 || k === goalKey || startCells.includes(k)) continue;
      const t = tilesByKey.get(k);
      if (!t || t.type !== "normal") continue;
      if (rng() < 0.18) t.type = "crumbling";
    }
  }

  if (opts.moving) {
    const candidates = [...tilesByKey.values()].filter(t =>
      t.type === "normal" && `${t.x},${t.z}` !== goalKey && !startCells.includes(`${t.x},${t.z}`)
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

  // single-island portal: two distant tiles linked (only used in non-island mode)
  if (opts.portal) {
    const candidates = [...tilesByKey.values()].filter(t =>
      t.type === "normal" && `${t.x},${t.z}` !== goalKey && !startCells.includes(`${t.x},${t.z}`)
    );
    if (candidates.length >= 6) {
      const a = candidates.splice(Math.floor(rng() * candidates.length), 1)[0];
      candidates.sort((p, q) => Math.hypot(q.x - a.x, q.z - a.z) - Math.hypot(p.x - a.x, p.z - a.z));
      const b = candidates[0];
      a.type = "portal"; a.target = { x: b.x, z: b.z };
      b.type = "portal"; b.target = { x: a.x, z: a.z };
    }
  }

  return [...tilesByKey.values()];
}

// ---- Island builder (used when portal mechanic is ON) ---------------
function buildIslandLevel(rng, steps, difficulty, seed, mechanics, gridSize, expansionOpts) {
  const islandCount = 2 + Math.floor(rng() * 3); // 2–4 islands
  const stepsPerIsland = Math.max(8, Math.floor(steps * 0.75 / islandCount));
  const islandHalf = Math.max(8, Math.floor(gridSize / 3));
  const bounds = { minX: -islandHalf, maxX: islandHalf, minZ: -islandHalf, maxZ: islandHalf };
  const mechNoPortal = { ...mechanics, portal: false };

  // Generate independent paths
  const rawPaths = Array.from({ length: islandCount }, () =>
    generateGoldenPath(rng, stepsPerIsland, bounds, expansionOpts)
  );

  // Bounding box helper
  function pathBBox(path) {
    let minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
    for (const s of path.pathStates)
      for (const [x, z] of cellsOf(s)) {
        minX=Math.min(minX,x); maxX=Math.max(maxX,x);
        minZ=Math.min(minZ,z); maxZ=Math.max(maxZ,z);
      }
    return { minX, maxX, minZ, maxZ };
  }

  // Lay islands out left-to-right with a guaranteed gap of 10–14 tiles
  const GAP = 10 + Math.floor(rng() * 5);
  let curX = 0;
  const offsets = rawPaths.map(p => {
    const bb = pathBBox(p);
    const off = { x: curX - bb.minX, z: -Math.round((bb.minZ + bb.maxZ) / 2) };
    curX += (bb.maxX - bb.minX + 1) + GAP;
    return off;
  });

  // Translate a path by an offset
  function translatePath(path, off) {
    const pathStates = path.pathStates.map(s => ({ ...s, x: s.x + off.x, z: s.z + off.z }));
    const visitedCells = new Map();
    for (const [k, v] of path.visitedCells) {
      const [x, z] = k.split(',').map(Number);
      visitedCells.set(`${x + off.x},${z + off.z}`, v);
    }
    return { pathStates, solution: path.solution, visitedCells };
  }

  const islands = rawPaths.map((p, i) => translatePath(p, offsets[i]));

  // Inject hazards per island (no portals yet)
  const allTiles = new Map();
  for (const isl of islands) {
    const tiles = injectHazards(isl, mechNoPortal, rng);
    for (const t of tiles) allTiles.set(`${t.x},${t.z}`, t);
  }

  // Wire portal pairs: exit of island i → entry of island i+1
  for (let i = 0; i < islandCount - 1; i++) {
    const exitS  = islands[i].pathStates[islands[i].pathStates.length - 1];
    const entryS = islands[i + 1].pathStates[0];

    const ek = `${exitS.x},${exitS.z}`;
    const enk = `${entryS.x},${entryS.z}`;

    const exitT  = allTiles.get(ek)  || { x: exitS.x,  z: exitS.z  };
    const entryT = allTiles.get(enk) || { x: entryS.x, z: entryS.z };

    exitT.type  = "portal"; exitT.target  = { x: entryS.x, z: entryS.z };
    entryT.type = "portal"; entryT.target = { x: exitS.x,  z: exitS.z  };

    allTiles.set(ek, exitT);
    allTiles.set(enk, entryT);
  }

  const combinedPathStates = islands.flatMap(isl => isl.pathStates);
  const combinedSolution   = islands.flatMap(isl => isl.solution);
  const start = islands[0].pathStates[0];
  const lastIsl = islands[islandCount - 1];
  const goal  = lastIsl.pathStates[lastIsl.pathStates.length - 1];

  return {
    level_metadata: {
      id: `lvl_${seed.toString(16)}_${Date.now().toString(36)}`,
      difficulty, seed,
      steps_to_solve: combinedSolution.length,
      island_count: islandCount,
    },
    world_settings: { environment: "abyss_default", gravity: 1.0 },
    start_state: {
      pos: { x: start.x, z: start.z },
      orientation: start.o === "V" ? "vertical" : start.o === "HX" ? "horizontal-x" : "horizontal-z",
    },
    hole_pos: { x: goal.x, z: goal.z },
    tiles: [...allTiles.values()],
    solution_data: combinedSolution,
    _internal: { pathStates: combinedPathStates, islandCount },
  };
}

// ---- Top-level builder -----------------------------------------------
function buildLevel({ difficulty = 5, seed = 42, mechanics = {}, gridSize = 40, expansionOpts = {} }) {
  const rng = makeRNG(seed);
  const steps = 8 + difficulty * 6;

  if (mechanics.portal) {
    return buildIslandLevel(rng, steps, difficulty, seed, mechanics, gridSize, expansionOpts);
  }

  const half = Math.floor(gridSize / 2);
  const bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
  const path = generateGoldenPath(rng, steps, bounds, expansionOpts);
  const tiles = injectHazards(path, mechanics, rng);

  const start = path.pathStates[0];
  const goal  = path.pathStates[path.pathStates.length - 1];

  return {
    level_metadata: {
      id: `lvl_${seed.toString(16)}_${Date.now().toString(36)}`,
      difficulty, seed,
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
