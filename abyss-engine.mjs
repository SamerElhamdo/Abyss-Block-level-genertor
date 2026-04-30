/**
 * Abyss Block Engine — Node.js / ESM
 * Synced with engine.jsx. No browser globals.
 *
 * mechanics object accepts extra tuning fields:
 *   fragileRate   (0–1, default 0.35) — probability a horizontal-only cell becomes fragile
 *   crumblingRate (0–1, default 0.18) — probability a single-visit cell becomes crumbling
 *
 * expansionOpts: { directions: string[], spreadDeg: number }
 *   directions: subset of ["north","east","south","west"] (max 2)
 *   spreadDeg:  total cone width in degrees (20–360)
 */

// ---- RNG -----------------------------------------------------------
function makeRNG(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Block primitives ----------------------------------------------
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

// ---- Stage A: Reverse Random Walk ----------------------------------
function generateGoldenPath(rng, steps, bounds, expansionOpts = {}) {
  const {
    directions     = [],
    spreadDeg      = 360,
    deviationPct   = 0,
    crossAxisLimit = 0,
    // dirAngleDeg: explicit cone-centre angle in degrees.
    //   0 = east, 90 = south, 180 = west, 270 = north.
    //   Takes priority over `directions[]`.
    //   Default undefined → fall back to directions[].
    dirAngleDeg    = undefined,
  } = expansionOpts;

  // atan2(z,x) space: east=0, south=PI/2, west=±PI, north=-PI/2
  const DIR_ANGLE = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 };
  const halfSpread = (spreadDeg / 2) * (Math.PI / 180);

  // Cone centres — prefer explicit angle over named directions
  const centers = dirAngleDeg !== undefined
    ? [dirAngleDeg * Math.PI / 180]
    : directions.map(d => DIR_ANGLE[d]).filter(a => a !== undefined);

  // Cross-axis constraint: limit the perpendicular axis to ±crossAxisLimit cells.
  // Determine which axis is "cross" from the primary cone angle.
  //   |cos(angle)| ≥ |sin(angle)|  → mainly east/west  → cross = Z
  //   |sin(angle)| >  |cos(angle)| → mainly north/south → cross = X
  let crossAxis = null;
  if (crossAxisLimit > 0 && centers.length > 0) {
    const primaryAngle = centers[0];
    crossAxis = Math.abs(Math.cos(primaryAngle)) >= Math.abs(Math.sin(primaryAngle)) ? 'z' : 'x';
  }

  function isAllowedPos(x, z) {
    // 1. Cross-axis hard limit (aspect-ratio constraint)
    if (crossAxis === 'z' && Math.abs(z) > crossAxisLimit) return false;
    if (crossAxis === 'x' && Math.abs(x) > crossAxisLimit) return false;

    // 2. Directional cone
    if (centers.length === 0) return true;
    if (deviationPct > 0 && rng() < deviationPct) return true;
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
        x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ)) continue;
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

  // Force V start: trim leading non-V states so the block always starts upright
  {
    let ti = 0;
    while (ti < pathStates.length - 1 && pathStates[ti].o !== 'V') ti++;
    if (ti > 0) { pathStates.splice(0, ti); solution.splice(0, ti); }
  }

  // Compute bounding box from the (trimmed) path cells
  let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
  for (const s of pathStates) {
    for (const [x, z] of cellsOf(s)) {
      if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x;
      if (z < bMinZ) bMinZ = z; if (z > bMaxZ) bMaxZ = z;
    }
  }
  const mapBounds = { minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ,
                      width: bMaxX - bMinX + 1, length: bMaxZ - bMinZ + 1 };

  return { pathStates, solution, visitedCells, mapBounds };
}

// ---- Stage B: Hazard injection -------------------------------------
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

  const fragileRate   = opts.fragileRate   ?? 0.35;
  const crumblingRate = opts.crumblingRate ?? 0.18;

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
      if (verticalCells.has(k) || k === goalKey || startCells.includes(k)) continue;
      const t = tilesByKey.get(k);
      if (t && rng() < fragileRate) t.type = "fragile";
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
      if (rng() < crumblingRate) t.type = "crumbling";
    }
  }

  if (opts.moving) {
    const occupied = new Set(tilesByKey.keys());
    const candidates = [...tilesByKey.values()].filter(t =>
      t.type === "normal" && `${t.x},${t.z}` !== goalKey && !startCells.includes(`${t.x},${t.z}`)
    );
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const needed = Math.min(3, Math.floor(candidates.length / 30));
    let placed = 0;
    for (const c of candidates) {
      if (placed >= needed) break;
      const moveLen = 1 + Math.floor(rng() * 2);
      const dirs = [
        { axis: "x", dir:  1 },
        { axis: "x", dir: -1 },
        { axis: "z", dir:  1 },
        { axis: "z", dir: -1 },
      ].sort(() => rng() - 0.5);
      for (const { axis, dir } of dirs) {
        let clear = true;
        for (let s = 1; s <= moveLen; s++) {
          const nx = c.x + (axis === "x" ? dir * s : 0);
          const nz = c.z + (axis === "z" ? dir * s : 0);
          if (occupied.has(`${nx},${nz}`)) { clear = false; break; }
        }
        if (!clear) continue;
        c.type = "moving";
        const base = axis === "x" ? c.x : c.z;
        const end  = base + dir * moveLen;
        c.params = {
          axis,
          range: dir > 0 ? [base, end] : [end, base],
          speed: +(0.8 + rng() * 1.5).toFixed(2),
        };
        placed++;
        break;
      }
    }
  }

  // legacy single-island portal (only when called outside island mode)
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

// ---- Island builder ------------------------------------------------
function buildIslandLevel(rng, steps, difficulty, seed, mechanics, gridSize, expansionOpts) {
  const islandCount = 2 + Math.floor(rng() * 3); // 2–4
  const stepsPerIsland = Math.max(8, Math.floor(steps * 0.75 / islandCount));
  const islandHalf = Math.max(8, Math.floor(gridSize / 3));
  const bounds = { minX: -islandHalf, maxX: islandHalf, minZ: -islandHalf, maxZ: islandHalf };
  const mechNoPortal = { ...mechanics, portal: false };

  const rawPaths = Array.from({ length: islandCount }, () =>
    generateGoldenPath(rng, stepsPerIsland, bounds, expansionOpts)
  );

  function pathBBox(path) {
    let minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
    for (const s of path.pathStates)
      for (const [x, z] of cellsOf(s)) {
        minX=Math.min(minX,x); maxX=Math.max(maxX,x);
        minZ=Math.min(minZ,z); maxZ=Math.max(maxZ,z);
      }
    return { minX, maxX, minZ, maxZ };
  }

  const GAP = 3 + Math.floor(rng() * 3); // 3–5 tiles between islands

  // Lay islands right-to-left so the directional flow is consistent:
  // island 0 (first visited) = easternmost, each next island to its west.
  // Within each island the path flows east→west (start east, portal-exit at origin/west),
  // so portal jumps always go leftward and the level reads as one continuous westward path.
  const bboxes = rawPaths.map(pathBBox);
  const totalW = bboxes.reduce((s, bb) => s + (bb.maxX - bb.minX + 1), 0) + GAP * (islandCount - 1);
  let curX = totalW;
  const offsets = bboxes.map(bb => {
    curX -= (bb.maxX - bb.minX + 1);
    const off = { x: curX - bb.minX, z: -Math.round((bb.minZ + bb.maxZ) / 2) };
    curX -= GAP;
    return off;
  });

  function translatePath(path, off) {
    const pathStates = path.pathStates.map(s => ({ ...s, x: s.x + off.x, z: s.z + off.z }));
    const visitedCells = new Map();
    for (const [k, v] of path.visitedCells) {
      const [x, z] = k.split(',').map(Number);
      visitedCells.set(`${x + off.x},${z + off.z}`, v);
    }
    return { pathStates, solution: path.solution, visitedCells };
  }

  // Find the earliest V state whose cell is never reused in any later footprint.
  // Portal entry tile is deleted on activation; if later states stand on it the block falls.
  function findSafeEntryIdx(pathStates) {
    for (let i = 0; i < pathStates.length - 1; i++) {
      if (pathStates[i].o !== 'V') continue;
      const cx = pathStates[i].x, cz = pathStates[i].z;
      const reused = pathStates.slice(i + 1).some(s =>
        cellsOf(s).some(([x, z]) => x === cx && z === cz)
      );
      if (!reused) return i;
    }
    // Fallback: last V state (entry cell guaranteed not reused afterward)
    for (let i = pathStates.length - 2; i >= 0; i--) {
      if (pathStates[i].o === 'V') return i;
    }
    return 0;
  }

  const islands = rawPaths.map((p, i) => {
    const tr = translatePath(p, offsets[i]);
    const safeIdx = findSafeEntryIdx(tr.pathStates);
    if (safeIdx > 0) {
      return { ...tr, pathStates: tr.pathStates.slice(safeIdx), solution: tr.solution.slice(safeIdx) };
    }
    return tr;
  });

  const allTiles = new Map();
  for (const isl of islands) {
    const tiles = injectHazards(isl, mechNoPortal, rng);
    for (const t of tiles) allTiles.set(`${t.x},${t.z}`, t);
  }

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

  // Compute bounding box across all island tiles
  let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
  for (const t of allTiles.values()) {
    if (t.x < bMinX) bMinX = t.x; if (t.x > bMaxX) bMaxX = t.x;
    if (t.z < bMinZ) bMinZ = t.z; if (t.z > bMaxZ) bMaxZ = t.z;
  }
  const mapBounds = {
    minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ,
    width: bMaxX - bMinX + 1, length: bMaxZ - bMinZ + 1,
  };
  const layoutDir = expansionOpts.dirAngleDeg !== undefined
    ? `${expansionOpts.dirAngleDeg}deg`
    : (expansionOpts.directions?.[0] ?? "free");

  return {
    level_metadata: {
      id: `lvl_${seed.toString(16)}_${Date.now().toString(36)}`,
      difficulty, seed,
      steps_to_solve: combinedSolution.length,
      island_count: islandCount,
      map_bounds:  mapBounds,
      layout_dir:  layoutDir,
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

// ---- Top-level builder ---------------------------------------------
export function buildLevel({
  difficulty = 5,
  seed = 42,
  mechanics = {},
  gridSize = 40,
  expansionOpts = {},
}) {
  const rng = makeRNG(seed);
  const steps = 8 + difficulty * 6;

  const mech = {
    fragile:       mechanics.fragile       ?? false,
    crumbling:     mechanics.crumbling     ?? false,
    moving:        mechanics.moving        ?? false,
    portal:        mechanics.portal        ?? false,
    fragileRate:   mechanics.fragileRate   ?? 0.35,
    crumblingRate: mechanics.crumblingRate ?? 0.18,
  };

  if (mech.portal) {
    return buildIslandLevel(rng, steps, difficulty, seed, mech, gridSize, expansionOpts);
  }

  const half = Math.floor(gridSize / 2);
  const bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
  const path  = generateGoldenPath(rng, steps, bounds, expansionOpts);
  const tiles = injectHazards(path, mech, rng);

  const start = path.pathStates[0];
  const goal  = path.pathStates[path.pathStates.length - 1];

  return {
    level_metadata: {
      id: `lvl_${seed.toString(16)}_${Date.now().toString(36)}`,
      difficulty, seed,
      steps_to_solve: path.solution.length,
      map_bounds: path.mapBounds,
      layout_dir: expansionOpts.dirAngleDeg !== undefined
        ? `${expansionOpts.dirAngleDeg}deg`
        : (expansionOpts.directions?.[0] ?? "free"),
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

// ---- Simulation (step-by-step with tile destruction) ---------------
// Returns { ok: true } or { ok: false, step, dir, reason, state }
export function simulateLevel(data) {
  const tileMap = new Map(data.tiles.map(t => [t.x + ',' + t.z, { ...t }]));
  const portals  = new Map(
    data.tiles.filter(t => t.type === 'portal' && t.target)
              .map(t => [t.x + ',' + t.z, t.target])
  );

  const s = data.start_state;
  let cur = {
    x: s.pos.x, z: s.pos.z,
    o: s.orientation === 'vertical' ? 'V' : s.orientation === 'horizontal-x' ? 'HX' : 'HZ',
  };

  for (let i = 0; i < data.solution_data.length; i++) {
    const dir  = data.solution_data[i];
    const next = rollForward(cur, dir);
    const foot = cellsOf(next);

    // 1. Check every footprint cell exists
    for (const [x, z] of foot) {
      if (!tileMap.has(x + ',' + z)) {
        return { ok: false, step: i + 1, dir, reason: `missing (${x},${z})`, state: cur };
      }
    }

    // 2. Handle tile types on landing
    for (const [x, z] of foot) {
      const tile = tileMap.get(x + ',' + z);
      if (tile.type === 'crumbling') {
        tileMap.delete(x + ',' + z);
      } else if (tile.type === 'fragile' && next.o === 'V') {
        // Fragile tile collapses under full vertical weight — block falls
        return { ok: false, step: i + 1, dir, reason: `fragile tile (${x},${z}) collapsed under vertical block`, state: next };
      }
    }

    // 3. Portal teleport (V on portal → jump; both portal tiles are deleted on activation)
    if (next.o === 'V' && portals.has(next.x + ',' + next.z)) {
      const exitKey  = next.x + ',' + next.z;
      const tg       = portals.get(exitKey);
      const entryKey = tg.x + ',' + tg.z;
      tileMap.delete(exitKey);
      tileMap.delete(entryKey);
      cur = { x: tg.x, z: tg.z, o: 'V' };
    } else {
      cur = next;
    }
  }

  const g = data.hole_pos;
  if (cur.o !== 'V' || cur.x !== g.x || cur.z !== g.z) {
    return { ok: false, step: -1, dir: null, reason: `ended at (${cur.x},${cur.z},${cur.o}) ≠ goal (${g.x},${g.z})`, state: cur };
  }
  return { ok: true };
}

// ---- Prune tiles not visited by the solution path ------------------
// Removes tiles the block never touches (safe to call after simulateLevel passes).
export function pruneUnreachableTiles(data) {
  const tileMap  = new Map(data.tiles.map(t => [t.x + ',' + t.z, { ...t }]));
  const portals  = new Map(
    data.tiles.filter(t => t.type === 'portal' && t.target)
              .map(t => [t.x + ',' + t.z, t.target])
  );
  const reachable = new Set();

  const s = data.start_state;
  let cur = {
    x: s.pos.x, z: s.pos.z,
    o: s.orientation === 'vertical' ? 'V' : s.orientation === 'horizontal-x' ? 'HX' : 'HZ',
  };
  cellsOf(cur).forEach(([x, z]) => reachable.add(x + ',' + z));

  for (const dir of data.solution_data) {
    const next = rollForward(cur, dir);
    cellsOf(next).forEach(([x, z]) => reachable.add(x + ',' + z));
    for (const [x, z] of cellsOf(next)) {
      const tile = tileMap.get(x + ',' + z);
      if (!tile) continue;
      if (tile.type === 'crumbling') tileMap.delete(x + ',' + z);
    }
    if (next.o === 'V' && portals.has(next.x + ',' + next.z)) {
      const exitKey  = next.x + ',' + next.z;
      const tg       = portals.get(exitKey);
      const entryKey = tg.x + ',' + tg.z;
      reachable.add(entryKey); // entry portal is consumed during play — must stay in tile set
      tileMap.delete(exitKey);
      tileMap.delete(entryKey);
      cur = { x: tg.x, z: tg.z, o: 'V' };
    } else {
      cur = next;
    }
  }

  return { ...data, tiles: data.tiles.filter(t => reachable.has(t.x + ',' + t.z)) };
}

// ---- Verified builder with retry -----------------------------------
// constraints: { minMoves, maxMoves }
// minMoves/maxMoves gate the random-walk path length (layout complexity).
// BFS optimisation runs unconditionally afterward — the stored solution is
// always the shortest valid path, regardless of the minMoves floor.
export function buildLevelVerified(opts, constraints = {}, maxAttempts = 15) {
  const { minMoves = 0, maxMoves = Infinity } = constraints;

  let lastLvl = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptOpts = attempt === 0
      ? opts
      : { ...opts, seed: (opts.seed ^ (attempt * 0x1f2e3d4c)) >>> 0 };

    const lvl = buildLevel(attemptOpts);
    lastLvl = lvl;

    // Gate on random-walk path length (ensures layout is complex enough)
    const walkMoves = lvl.solution_data.length;
    if (walkMoves < minMoves || walkMoves > maxMoves) continue;

    // Full physics verification
    if (!simulateLevel(lvl).ok) continue;

    // Find & apply the absolute shortest solution, then re-prune tiles
    const pruned  = pruneUnreachableTiles(lvl);
    const optimal = optimizeSolution(pruned);   // always finds shortest, no floor
    return { lvl: optimal, attempts: attempt + 1, verified: true };
  }

  // Fallback: return last generated without BFS if all retries exhausted
  return { lvl: lastLvl, attempts: maxAttempts, verified: false };
}

// ---- BFS: find shortest valid solution --------------------------------
// Always finds the absolute shortest path (no minimum floor).
// Verifies the candidate with simulateLevel before accepting.
// Re-prunes tiles to only those visited by the shorter solution.
// Returns updated data, or original if no shorter path found.
export function optimizeSolution(data) {
  const DIRS = ['right', 'left', 'down', 'up'];

  // Build tile set and type map for BFS
  const tileSet     = new Set(data.tiles.map(t => `${t.x},${t.z}`));
  const tileTypeMap = new Map(data.tiles.map(t => [`${t.x},${t.z}`, t.type]));

  // Portal map: exit cell → target {x,z}
  const portalExit = new Map(
    data.tiles.filter(t => t.type === 'portal' && t.target)
              .map(t => [`${t.x},${t.z}`, t.target])
  );

  const s  = data.start_state;
  const sx = s.pos.x, sz = s.pos.z;
  const so = s.orientation === 'vertical' ? 'V'
           : s.orientation === 'horizontal-x' ? 'HX' : 'HZ';
  const goal = data.hole_pos;

  // BFS state key: x,z,o  (portal order is implied by void separation)
  const startKey = `${sx},${sz},${so}`;
  const prev = new Map([[startKey, null]]);  // key → { fromKey, dir }
  const queue = [{ x: sx, z: sz, o: so }];
  let foundKey = null;

  const MAX_NODES = 600_000;
  let visited = 0;

  outer: while (queue.length > 0 && visited < MAX_NODES) {
    const cur = queue.shift();
    visited++;

    for (const dir of DIRS) {
      const next = rollForward(cur, dir);
      const foot = cellsOf(next);

      // All footprint cells must be present; V on fragile = instant fall (skip)
      let ok = true;
      for (const [fx, fz] of foot) {
        if (!tileSet.has(`${fx},${fz}`)) { ok = false; break; }
        if (next.o === 'V' && tileTypeMap.get(`${fx},${fz}`) === 'fragile') { ok = false; break; }
      }
      if (!ok) continue;

      // Portal teleport: V landing on an exit portal
      let land = next;
      if (next.o === 'V' && portalExit.has(`${next.x},${next.z}`)) {
        const tg = portalExit.get(`${next.x},${next.z}`);
        land = { x: tg.x, z: tg.z, o: 'V' };
      }

      const nk = `${land.x},${land.z},${land.o}`;
      if (prev.has(nk)) continue;
      prev.set(nk, { fromKey: `${cur.x},${cur.z},${cur.o}`, dir });
      queue.push(land);

      if (land.o === 'V' && land.x === goal.x && land.z === goal.z) {
        foundKey = nk;
        break outer;
      }
    }
  }

  if (!foundKey) return data;

  // Reconstruct move sequence
  const moves = [];
  let k = foundKey;
  while (prev.get(k) !== null) {
    const { fromKey, dir } = prev.get(k);
    moves.unshift(dir);
    k = fromKey;
  }

  // Only accept if strictly shorter
  if (moves.length >= data.solution_data.length) return data;

  // Verify the candidate path with full physics simulation
  const candidate = { ...data, solution_data: moves };
  if (!simulateLevel(candidate).ok) return data;

  // Update solution and prune tiles to only those the shortest path visits.
  return pruneUnreachableTiles({ ...data, solution_data: moves });
}

// ---- Difficulty score from actual level content ---------------------
// Returns a float in [1, 10].
// Components:
//   moves  — length relative to a 70-move ceiling   (0-4 pts)
//   fragile — fragile tiles / total tiles            (0-2.5 pts)
//   crumbling — crumbling tiles / total tiles        (0-1.5 pts)
//   moving — moving tile count (capped at 5)         (0-1 pt)
//   portal — islands > 1                             (0-1 pt)
export function computeDifficultyScore(data) {
  const tiles     = data.tiles;
  const total     = tiles.length || 1;
  const fragile   = tiles.filter(t => t.type === 'fragile').length;
  const crumbling = tiles.filter(t => t.type === 'crumbling').length;
  const moving    = tiles.filter(t => t.type === 'moving').length;
  const portals   = tiles.filter(t => t.type === 'portal').length;
  const moves     = data.solution_data.length;

  const movePts      = Math.min(moves / 70, 1) * 4;
  const fragilePts   = (fragile   / total) * 2.5;
  const crumblePts   = (crumbling / total) * 1.5;
  const movingPts    = Math.min(moving / 5, 1) * 1;
  const portalPts    = portals > 0 ? 1 : 0;

  const raw = movePts + fragilePts + crumblePts + movingPts + portalPts;
  return Math.max(1, Math.min(10, +raw.toFixed(2)));
}

// ---- Tile stats helper ---------------------------------------------
export function tileStats(data) {
  const counts = { normal: 0, fragile: 0, crumbling: 0, moving: 0, portal: 0 };
  for (const t of data.tiles) {
    const k = t.type ?? 'normal';
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const total = data.tiles.length || 1;
  const traps = counts.fragile + counts.crumbling + counts.moving;
  return { ...counts, total, trap_density: +(traps / total).toFixed(3) };
}

export { makeRNG, rollForward, rollReverse, cellsOf, stateKey, generateGoldenPath, injectHazards };
