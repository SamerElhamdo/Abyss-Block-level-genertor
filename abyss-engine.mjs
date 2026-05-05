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

// ---- Step-count moving tile helpers --------------------------------
// Moving tiles oscillate between range[0] and range[1] along one axis.
// The tile spends `stepsPerPhase` player-steps at each position before moving.
// `startPhase` offsets the cycle so the tile can start at any point in its loop.
//
// Cycle (triangle wave): range[0] → range[1] → range[0] → ...
// Period = 2 * (range[1] - range[0]) * stepsPerPhase  player-steps.

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lcmTwo(a, b) { const g = gcd(a, b); return g === 0 ? 1 : (a / g) * b; }

// Returns the global step-count period (LCM of all moving tile periods, capped at 120).
function computeMovingTilePeriod(tiles) {
  let period = 1;
  for (const t of tiles) {
    if (t.type !== 'moving' || !t.params?.stepsPerPhase) continue;
    const { range, stepsPerPhase } = t.params;
    const width = range[1] - range[0];
    if (width <= 0) continue;
    const p = 2 * width * stepsPerPhase;
    period = lcmTwo(period, p);
    if (period > 120) return 120;
  }
  return period;
}

// Returns { x, z } of a moving tile at a given player-step count.
function getTilePositionAtStep(tile, step) {
  const { axis, range, stepsPerPhase = 1, startPhase = 0 } = tile.params;
  const width = range[1] - range[0];
  if (width <= 0) return { x: tile.x, z: tile.z };
  const period = 2 * width * stepsPerPhase;
  const t      = (step + startPhase) % period;
  const phaseIdx = Math.floor(t / stepsPerPhase);
  const offset   = phaseIdx <= width ? phaseIdx : 2 * width - phaseIdx;
  const pos      = range[0] + offset;
  return axis === 'x' ? { x: pos, z: tile.z } : { x: tile.x, z: pos };
}

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

// ---- Approximate critical cells from golden path -------------------
// A cell visited exactly once in the path cannot be avoided (in the golden path).
function localCriticalCells(pathStates) {
  const visitCount = new Map();
  for (const s of pathStates) {
    for (const [x, z] of cellsOf(s)) {
      const k = `${x},${z}`;
      visitCount.set(k, (visitCount.get(k) || 0) + 1);
    }
  }
  const critical = new Set();
  for (const [k, count] of visitCount) {
    if (count === 1) critical.add(k);
  }
  return critical;
}

// ---- Stage B: Hazard injection -------------------------------------
// stepOffset: global step index at which this island's path begins (0 for single-island levels).
// Moving tile startPhase must be computed against the GLOBAL step count so that
// simulateLevel (which counts steps globally) finds the tile in the correct position.
function injectHazards(level, opts, rng, stepOffset = 0) {
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

  const fragileRate    = opts.fragileRate    ?? 0.35;
  const crumblingRate  = opts.crumblingRate  ?? 0.18;
  const constraintMode = opts.constraintMode ?? false;
  const localCritical  = constraintMode ? localCriticalCells(pathStates) : null;

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
      if (!t) continue;
      // In constraint mode: strongly prefer critical tiles (single-visit), reduce noise elsewhere
      const rate = (constraintMode && localCritical)
        ? (localCritical.has(k) ? Math.min(fragileRate * 1.5, 0.9) : fragileRate * 0.4)
        : fragileRate;
      if (rng() < rate) t.type = "fragile";
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
      // In constraint mode: prefer critical single-visit tiles, suppress decorative ones
      const rate = (constraintMode && localCritical)
        ? (localCritical.has(k) ? Math.min(crumblingRate * 2.0, 0.8) : crumblingRate * 0.3)
        : crumblingRate;
      if (rng() < rate) t.type = "crumbling";
    }
  }

  if (opts.moving) {
    // ── Moving-tile placement rules ──────────────────────────────────────────
    // Shape: exactly 3 cells on one axis  [center-1 | CENTER | center+1]
    //   center   = the path cell — the only crossing position for the player
    //   center±1 = extend into the void; must be EMPTY in the static tile map
    // Motion: triangle-wave  center-1 → center → center+1 → center → …
    //   The tile oscillates symmetrically; it passes through center twice per cycle.
    // Collision rule: all 3 cells are verified clear of any static tile.
    // Timing: startPhase is set so the tile is AT center when the golden path
    //   first steps onto this cell (global step count for multi-island levels).
    // ─────────────────────────────────────────────────────────────────────────
    const occupied = new Set(tilesByKey.keys());

    // Narrow-corridor check: a candidate is suitable if it has at most 2 tile-neighbours
    // (one incoming, one outgoing). Cells at intersections (3+ neighbours) can be bypassed.
    function isNarrowCorridor(candidateKey) {
      const [cx, cz] = candidateKey.split(',').map(Number);
      const neighbours = [[1,0],[-1,0],[0,1],[0,-1]]
        .filter(([dx,dz]) => occupied.has(`${cx+dx},${cz+dz}`));
      return neighbours.length <= 2;
    }

    // Candidates: normal tiles that were critical in the golden path AND sit in a
    // narrow corridor (no intersection tile that lets the block detour around them).
    const criticalForMoving = localCriticalCells(pathStates);

    // Pre-compute first-reach step for every cell in the golden path.
    const stepReachMap = new Map();
    for (let si = 0; si < pathStates.length; si++) {
      for (const [px, pz] of cellsOf(pathStates[si])) {
        const k = `${px},${pz}`;
        if (!stepReachMap.has(k)) stepReachMap.set(k, si);
      }
    }

    // Compute tile bounds for out-of-bounds guard
    const tileXArr = [...tilesByKey.values()].map(t => t.x);
    const tileZArr = [...tilesByKey.values()].map(t => t.z);
    const tMinX = Math.min(...tileXArr), tMaxX = Math.max(...tileXArr);
    const tMinZ = Math.min(...tileZArr), tMaxZ = Math.max(...tileZArr);

    const candidates = [...tilesByKey.values()].filter(t => {
      const k = `${t.x},${t.z}`;
      return t.type === "normal" &&
        k !== goalKey &&
        !startCells.includes(k) &&
        criticalForMoving.has(k);
    });
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const stepsPerPhase = 1 + Math.floor(rng() * 2);   // 1–2 player-steps per position
    // period = 2 * width * stepsPerPhase = 2 * 2 * stepsPerPhase = 4 * stepsPerPhase
    const width  = 2;     // always: center-1 … center … center+1
    const period = 2 * width * stepsPerPhase;

    let placed = 0;

    for (const c of candidates) {
      if (placed >= 1) break;

      // Try both axes; pick the first where both ±1 neighbours are void.
      const axes = ['x', 'z'].sort(() => rng() - 0.5);
      for (const axis of axes) {
        const center = axis === 'x' ? c.x : c.z;
        const lo = center - 1;
        const hi = center + 1;
        const kLo = axis === 'x' ? `${lo},${c.z}` : `${c.x},${lo}`;
        const kHi = axis === 'x' ? `${hi},${c.z}` : `${c.x},${hi}`;

        // Both endpoint cells must be void (no static tile, no other path tile).
        if (occupied.has(kLo) || occupied.has(kHi)) continue;

        // Both void endpoints must stay within the visible map bounds (±1 is ok, ±2 is not).
        if (axis === 'x' && (lo < tMinX - 1 || hi > tMaxX + 1)) continue;
        if (axis === 'z' && (lo < tMinZ - 1 || hi > tMaxZ + 1)) continue;

        // range = [center-1, center+1]; the triangle wave visits lo → center → hi → center → lo…
        const range = [lo, hi];

        // startPhase is ALWAYS 0: tile starts at range[0] (void end), not at center.
        // This makes the timing puzzle visually unambiguous — the player sees a gap
        // from the very first frame and must wait for the tile to swing to center.
        // The golden path will NOT pass simulateLevel with startPhase=0 (it was
        // generated without timing constraints). buildLevelVerified skips the golden-
        // path sim-check for moving levels and relies entirely on the BFS solution.
        const startPhase = 0;

        c.type   = "moving";
        c.params = { axis, range, stepsPerPhase, startPhase };
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
  let globalStepOffset = 0;
  for (const isl of islands) {
    const tiles = injectHazards(isl, mechNoPortal, rng, globalStepOffset);
    for (const t of tiles) allTiles.set(`${t.x},${t.z}`, t);
    globalStepOffset += isl.solution.length;
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
    fragile:        mechanics.fragile        ?? false,
    crumbling:      mechanics.crumbling      ?? false,
    moving:         mechanics.moving         ?? false,
    portal:         mechanics.portal         ?? false,
    fragileRate:    mechanics.fragileRate    ?? 0.35,
    crumblingRate:  mechanics.crumblingRate  ?? 0.18,
    constraintMode: mechanics.constraintMode ?? false,
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
// Moving tiles use step-count positions: at step N the tile is at getTilePositionAtStep(t, N).
export function simulateLevel(data) {
  // Static tile map (mutable: crumbling/portal tiles removed as consumed).
  const staticMap = new Map(
    data.tiles.filter(t => t.type !== 'moving').map(t => [t.x + ',' + t.z, { ...t }])
  );
  const movingTiles = data.tiles.filter(t => t.type === 'moving');
  const portals = new Map(
    data.tiles.filter(t => t.type === 'portal' && t.target)
              .map(t => [t.x + ',' + t.z, t.target])
  );

  // Returns the tile map after applying moving tile positions at the given step.
  function tileMapAt(step) {
    const m = new Map(staticMap);
    for (const t of movingTiles) {
      const pos = getTilePositionAtStep(t, step);
      m.set(`${pos.x},${pos.z}`, { ...t, x: pos.x, z: pos.z });
    }
    return m;
  }

  const s = data.start_state;
  let cur = {
    x: s.pos.x, z: s.pos.z,
    o: s.orientation === 'vertical' ? 'V' : s.orientation === 'horizontal-x' ? 'HX' : 'HZ',
  };

  for (let i = 0; i < data.solution_data.length; i++) {
    const dir    = data.solution_data[i];
    const next   = rollForward(cur, dir);
    const foot   = cellsOf(next);
    const tileMap = tileMapAt(i);  // tile positions at current step — must match what player sees

    // 1. Every footprint cell must exist
    for (const [x, z] of foot) {
      if (!tileMap.has(x + ',' + z))
        return { ok: false, step: i + 1, dir, reason: `missing (${x},${z}) at step ${i + 1}`, state: cur };
    }

    // 2. Handle tile types on landing
    for (const [x, z] of foot) {
      const tile = tileMap.get(x + ',' + z);
      if (tile.type === 'crumbling') {
        staticMap.delete(x + ',' + z);
      } else if (tile.type === 'fragile' && next.o === 'V') {
        return { ok: false, step: i + 1, dir, reason: `fragile tile (${x},${z}) collapsed under vertical block`, state: next };
      }
    }

    // 3. Portal teleport
    if (next.o === 'V' && portals.has(next.x + ',' + next.z)) {
      const exitKey  = next.x + ',' + next.z;
      const tg       = portals.get(exitKey);
      const entryKey = tg.x + ',' + tg.z;
      staticMap.delete(exitKey);
      staticMap.delete(entryKey);
      cur = { x: tg.x, z: tg.z, o: 'V' };
    } else {
      cur = next;
    }
  }

  const g = data.hole_pos;
  if (cur.o !== 'V' || cur.x !== g.x || cur.z !== g.z)
    return { ok: false, step: -1, dir: null, reason: `ended at (${cur.x},${cur.z},${cur.o}) ≠ goal (${g.x},${g.z})`, state: cur };
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

  // Moving tiles are always kept — they are dynamic platforms whose base position
  // may not be visited, but they are essential game objects.
  let tiles = data.tiles.filter(t => t.type === 'moving' || reachable.has(t.x + ',' + t.z));

  // Isolation pass: remove tiles with no adjacent neighbor (iterative until stable).
  // Prevents orphan tiles that were reachable via a crumbling footprint partner that
  // no longer exists after crumbling removal, leaving them visually disconnected.
  const goalKey = `${data.hole_pos.x},${data.hole_pos.z}`;
  let changed = true;
  while (changed) {
    changed = false;
    // Include all positions a moving tile can occupy (its full oscillation range)
    const tileSet = new Set();
    for (const t of tiles) {
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
    tiles = tiles.filter(t => {
      if (t.type === 'moving') return true;
      if (`${t.x},${t.z}` === goalKey) return true;
      const hasNeighbor =
        tileSet.has(`${t.x + 1},${t.z}`) || tileSet.has(`${t.x - 1},${t.z}`) ||
        tileSet.has(`${t.x},${t.z + 1}`) || tileSet.has(`${t.x},${t.z - 1}`);
      if (!hasNeighbor) { changed = true; return false; }
      return true;
    });
  }

  return { ...data, tiles };
}

// ---- Verified builder with retry -----------------------------------
// constraints: { minMoves, maxMoves }
// minMoves/maxMoves gate the random-walk path length (layout complexity).
// BFS optimisation runs unconditionally afterward — the stored solution is
// always the shortest valid path, regardless of the minMoves floor.
export function buildLevelVerified(opts, constraints = {}, maxAttempts = 15) {
  // minMoves / maxMoves  — gate on the random-walk path length (layout complexity).
  // minBFSMoves          — gate on the BFS-optimal solution length (final playable length).
  //                        This is the stricter check: it rejects levels where a short
  //                        shortcut collapses the optimal solution below the target.
  const { minMoves = 0, maxMoves = Infinity, minBFSMoves = 0 } = constraints;

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

    // Moving tiles use startPhase=0, so the golden path was generated WITHOUT
    // timing constraints and will NOT pass simulateLevel. For levels with moving
    // tiles we skip the golden-path check and rely entirely on the BFS solution.
    const hasMoving = lvl.tiles.some(t => t.type === 'moving');
    if (!hasMoving && !simulateLevel(lvl).ok) continue;

    // Find the shortest valid solution via step-aware BFS, then re-prune tiles.
    const pruned  = pruneUnreachableTiles(lvl);
    const optimal = optimizeSolution(pruned);
    // Second prune with the final solution removes any orphan tiles that were
    // reachable via the random walk but not via the BFS-optimal path.
    const clean   = pruneUnreachableTiles(optimal);

    // BFS is the authoritative verifier — it must produce a valid simulation.
    if (!simulateLevel(clean).ok) continue;

    // Gate on BFS-optimal solution length: reject levels where shortcuts make the
    // puzzle trivially short even though the random walk was complex enough.
    if (clean.solution_data.length < minBFSMoves) continue;

    // Every moving tile center must actually be visited by the optimal path.
    // If the BFS found a route that bypasses a moving tile, reject this attempt.
    // If mechanics require a moving tile but none was placed, try to inject one
    // directly from the BFS path states (cells on the BFS path with ≤2 neighbours).
    if (hasMoving) {
      const ps = clean._internal?.pathStates ?? [];
      const placedMoving = clean.tiles.filter(t => t.type === 'moving');

      const allUsed = placedMoving.length > 0 && placedMoving.every(mt =>
        ps.some(s => {
          if (s.o === 'V')  return s.x === mt.x && s.z === mt.z;
          if (s.o === 'HX') return s.z === mt.z && (s.x === mt.x || s.x + 1 === mt.x);
          if (s.o === 'HZ') return s.x === mt.x && (s.z === mt.z || s.z + 1 === mt.z);
          return false;
        })
      );

      if (!allUsed) {
        const tilesByKeyOpt = new Map(clean.tiles.map(t => [`${t.x},${t.z}`, t]));
        const occupied = new Set(tilesByKeyOpt.keys());
        const startCellsOpt = cellsOf(ps[0]).map(([x,z]) => `${x},${z}`);
        const goalKeyMov = `${clean.hole_pos.x},${clean.hole_pos.z}`;
        const stepsPerPhase = 1 + Math.floor(makeRNG(attemptOpts.seed)() * 2);

        let injected = null;
        const mid = Math.floor(ps.length / 2);
        for (let di = 0; di < ps.length - 2 && !injected; di++) {
          const si = mid + (di % 2 === 0 ? di / 2 : -Math.ceil(di / 2));
          if (si <= 0 || si >= ps.length - 1) continue;
          const s = ps[si];
          const ck = `${s.x},${s.z}`;
          if (ck === goalKeyMov || startCellsOpt.includes(ck)) continue;
          const t = tilesByKeyOpt.get(ck);
          if (!t || t.type !== 'normal') continue;
          for (const axis of ['x', 'z']) {
            const center = axis === 'x' ? s.x : s.z;
            const lo = center - 1, hi = center + 1;
            const kLo = axis === 'x' ? `${lo},${s.z}` : `${s.x},${lo}`;
            const kHi = axis === 'x' ? `${hi},${s.z}` : `${s.x},${hi}`;
            if (occupied.has(kLo) || occupied.has(kHi)) continue;
            const tileXArr = [...tilesByKeyOpt.values()].map(t2 => t2.x);
            const tileZArr = [...tilesByKeyOpt.values()].map(t2 => t2.z);
            const tMinX = Math.min(...tileXArr), tMaxX = Math.max(...tileXArr);
            const tMinZ = Math.min(...tileZArr), tMaxZ = Math.max(...tileZArr);
            if (axis === 'x' && (lo < tMinX - 1 || hi > tMaxX + 1)) continue;
            if (axis === 'z' && (lo < tMinZ - 1 || hi > tMaxZ + 1)) continue;
            const newTiles = clean.tiles.map(tile => {
              if (`${tile.x},${tile.z}` === ck)
                return { ...tile, type: 'moving', params: { axis, range: [lo, hi], stepsPerPhase, startPhase: 0 } };
              if (tile.type === 'moving')
                return { x: tile.x, z: tile.z, type: 'normal' };
              return tile;
            });
            const candidate = { ...clean, tiles: newTiles };
            const simResult = simulateLevel(candidate);
            if (!simResult.ok) continue;
            const newOpt = optimizeSolution(candidate);
            if (!simulateLevel(newOpt).ok) continue;
            const newPs = newOpt._internal?.pathStates ?? [];
            const tileUsed = newPs.some(ns =>
              (ns.o === 'V'  && ns.x === s.x && ns.z === s.z) ||
              (ns.o === 'HX' && ns.z === s.z && (ns.x === s.x || ns.x + 1 === s.x)) ||
              (ns.o === 'HZ' && ns.x === s.x && (ns.z === s.z || ns.z + 1 === s.z))
            );
            if (tileUsed) {
              // Prune once more to remove any tiles orphaned by the injection
              const pInjected = pruneUnreachableTiles(newOpt);
              if (!simulateLevel(pInjected).ok) continue;
              injected = pInjected;
              break;
            }
          }
        }
        if (!injected) continue;
        return { lvl: injected, attempts: attempt + 1, verified: true };
      }
    }

    return { lvl: clean, attempts: attempt + 1, verified: true };
  }

  // Fallback: return last generated without BFS if all retries exhausted
  return { lvl: lastLvl, attempts: maxAttempts, verified: false };
}

// ---- BFS: find shortest valid solution --------------------------------
// Step-count aware: includes step % movingTilePeriod in state key so moving
// tile positions are correctly modelled. Falls back to step-agnostic BFS
// (period=1) when no step-based moving tiles are present.
export function optimizeSolution(data) {
  const DIRS = ['right', 'left', 'down', 'up'];

  const staticTiles   = data.tiles.filter(t => t.type !== 'moving');
  const movingTilesArr = data.tiles.filter(t => t.type === 'moving' && t.params?.stepsPerPhase);
  const period        = computeMovingTilePeriod(data.tiles);

  // Static tile lookups
  const staticSet     = new Set(staticTiles.map(t => `${t.x},${t.z}`));
  const staticTypeMap = new Map(staticTiles.map(t => [`${t.x},${t.z}`, t.type]));

  // Crumbling tile index: key → bit index (for bitmask state tracking).
  // Tracking consumed crumbling tiles prevents BFS from finding "shortcuts"
  // that step on an already-crumbled tile, which simulateLevel would reject.
  const crumblingTiles = staticTiles.filter(t => t.type === 'crumbling');
  const crumblingIndex = new Map(crumblingTiles.map((t, i) => [`${t.x},${t.z}`, i]));

  // Portal map: exit cell → target {x,z}
  const portalExit = new Map(
    data.tiles.filter(t => t.type === 'portal' && t.target)
              .map(t => [`${t.x},${t.z}`, t.target])
  );

  // Build tile set + type map for a specific player step (excluding consumed crumbling tiles)
  function tileInfoAtStep(step, crumbleMask) {
    const set     = new Set();
    const typeMap = new Map();
    for (const t of staticTiles) {
      const k = `${t.x},${t.z}`;
      const ci = crumblingIndex.get(k);
      if (ci !== undefined && (crumbleMask & (1 << ci))) continue; // already crumbled
      set.add(k);
      typeMap.set(k, t.type);
    }
    if (movingTilesArr.length > 0) {
      for (const t of movingTilesArr) {
        const pos = getTilePositionAtStep(t, step);
        set.add(`${pos.x},${pos.z}`);
        typeMap.set(`${pos.x},${pos.z}`, 'moving');
      }
    }
    return { set, typeMap };
  }

  const s  = data.start_state;
  const sx = s.pos.x, sz = s.pos.z;
  const so = s.orientation === 'vertical' ? 'V'
           : s.orientation === 'horizontal-x' ? 'HX' : 'HZ';
  const goal = data.hole_pos;

  // State key: x,z,o,stepMod,crumbleMask
  // crumbleMask tracks which crumbling tiles have been consumed (bitmask).
  // With max ~3 crumbling tiles this adds only 8 extra states per position.
  const startKey = `${sx},${sz},${so},0,0`;
  const prev = new Map([[startKey, null]]);
  const queue = [{ x: sx, z: sz, o: so, step: 0, crumbleMask: 0 }];
  let foundKey = null;

  const MAX_NODES = 600_000;
  let visited = 0;

  outer: while (queue.length > 0 && visited < MAX_NODES) {
    const cur = queue.shift();
    visited++;
    const nextStep = cur.step + 1;
    const { set: tileSet, typeMap: tileTypeMap } = tileInfoAtStep(cur.step, cur.crumbleMask);

    for (const dir of DIRS) {
      const next = rollForward(cur, dir);
      const foot = cellsOf(next);

      // All footprint cells must be present; V on fragile = instant fall
      let ok = true;
      let nextMask = cur.crumbleMask;
      for (const [fx, fz] of foot) {
        const fk = `${fx},${fz}`;
        if (!tileSet.has(fk)) { ok = false; break; }
        if (next.o === 'V' && tileTypeMap.get(fk) === 'fragile') { ok = false; break; }
        // Mark crumbling tiles as consumed upon landing
        const ci = crumblingIndex.get(fk);
        if (ci !== undefined) nextMask |= (1 << ci);
      }
      if (!ok) continue;

      // Portal teleport
      let land = next;
      if (next.o === 'V' && portalExit.has(`${next.x},${next.z}`)) {
        const tg = portalExit.get(`${next.x},${next.z}`);
        land = { x: tg.x, z: tg.z, o: 'V' };
      }

      const nk = `${land.x},${land.z},${land.o},${nextStep % period},${nextMask}`;
      if (prev.has(nk)) continue;
      prev.set(nk, { fromKey: `${cur.x},${cur.z},${cur.o},${cur.step % period},${cur.crumbleMask}`, dir });
      queue.push({ ...land, step: nextStep, crumbleMask: nextMask });

      if (land.o === 'V' && land.x === goal.x && land.z === goal.z) {
        foundKey = nk; break outer;
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

  if (moves.length >= data.solution_data.length) return data;

  const candidate = { ...data, solution_data: moves };
  if (!simulateLevel(candidate).ok) return data;

  // Rebuild pathStates from the optimized move sequence so _internal stays in sync
  const newPathStates = [{ x: sx, z: sz, o: so }];
  let curPS = { x: sx, z: sz, o: so };
  for (const dir of moves) {
    curPS = rollForward(curPS, dir);
    if (curPS.o === 'V' && portalExit.has(`${curPS.x},${curPS.z}`)) {
      const tg = portalExit.get(`${curPS.x},${curPS.z}`);
      curPS = { x: tg.x, z: tg.z, o: 'V' };
    }
    newPathStates.push(curPS);
  }

  const pruned = pruneUnreachableTiles({ ...data, solution_data: moves });
  return {
    ...pruned,
    _internal: { ...(pruned._internal ?? {}), pathStates: newPathStates },
  };
}

// ---- Critical tile detection via BFS + path enumeration ------------
// Returns Set<"x,z"> of tiles that appear on EVERY shortest solution path.
// These tiles are guaranteed to matter — any hazard placed on them is unavoidable.
export function computeCriticalTiles(data) {
  const DIRS = ['right', 'left', 'down', 'up'];
  const tileSet     = new Set(data.tiles.map(t => `${t.x},${t.z}`));
  const tileTypeMap = new Map(data.tiles.map(t => [`${t.x},${t.z}`, t.type]));
  const portalExit  = new Map(
    data.tiles.filter(t => t.type === 'portal' && t.target)
              .map(t => [`${t.x},${t.z}`, t.target])
  );

  const s  = data.start_state;
  const so = s.orientation === 'vertical' ? 'V' : s.orientation === 'horizontal-x' ? 'HX' : 'HZ';
  const goal = data.hole_pos;

  const startKey = `${s.pos.x},${s.pos.z},${so}`;
  // prev: stateKey → array of { fromKey, transitCells[] }  (multiple parents = multiple shortest paths)
  const dist = new Map([[startKey, 0]]);
  const prev = new Map([[startKey, []]]);
  const queue = [{ x: s.pos.x, z: s.pos.z, o: so }];
  let goalKey = null;

  const MAX_NODES = 600_000;
  let visited = 0;

  while (queue.length > 0 && visited < MAX_NODES) {
    const cur = queue.shift();
    const curKey = `${cur.x},${cur.z},${cur.o}`;
    const curDist = dist.get(curKey);
    visited++;

    for (const dir of DIRS) {
      const next = rollForward(cur, dir);
      const foot = cellsOf(next);

      let ok = true;
      for (const [fx, fz] of foot) {
        if (!tileSet.has(`${fx},${fz}`)) { ok = false; break; }
        if (next.o === 'V' && tileTypeMap.get(`${fx},${fz}`) === 'fragile') { ok = false; break; }
      }
      if (!ok) continue;

      // Cells visited before any portal jump (used to build path cell sets)
      const transitCells = cellsOf(next).map(([cx, cz]) => `${cx},${cz}`);

      let land = next;
      if (next.o === 'V' && portalExit.has(`${next.x},${next.z}`)) {
        const tg = portalExit.get(`${next.x},${next.z}`);
        land = { x: tg.x, z: tg.z, o: 'V' };
      }

      const nk = `${land.x},${land.z},${land.o}`;
      const nDist = curDist + 1;

      if (!dist.has(nk)) {
        dist.set(nk, nDist);
        prev.set(nk, [{ fromKey: curKey, transitCells }]);
        queue.push(land);
        if (land.o === 'V' && land.x === goal.x && land.z === goal.z) goalKey = nk;
      } else if (dist.get(nk) === nDist) {
        prev.get(nk).push({ fromKey: curKey, transitCells });
      }
    }
  }

  if (!goalKey) return new Set();

  // Enumerate up to MAX_PATHS shortest paths backward from goal, intersecting their cell sets.
  // A tile is critical if it appears in every path.
  const MAX_PATHS = 200;
  let critical = null;
  let pathCount = 0;

  function dfs(key, cells) {
    if (pathCount >= MAX_PATHS) return;

    const parts = key.split(',');
    const o = parts[parts.length - 1];
    const z = +parts[parts.length - 2];
    const x = +parts.slice(0, parts.length - 2).join(',');
    const stateKeys = cellsOf({ x, z, o }).map(([cx, cz]) => `${cx},${cz}`);
    const extended = cells.concat(stateKeys);

    const parents = prev.get(key);
    if (!parents || parents.length === 0) {
      pathCount++;
      const pathSet = new Set(extended);
      if (critical === null) {
        critical = pathSet;
      } else {
        for (const c of [...critical]) {
          if (!pathSet.has(c)) critical.delete(c);
        }
      }
      return;
    }

    for (const { fromKey, transitCells } of parents) {
      dfs(fromKey, extended.concat(transitCells));
    }
  }

  dfs(goalKey, []);
  return critical || new Set();
}

// ---- Behavioral difficulty metrics ---------------------------------
// Walks the solution path and measures player-experience-relevant signals.
// Returns a metrics object including behavioral_difficulty score in [1, 10].
export function computeBehavioralMetrics(data, criticalTiles = null) {
  const tileTypeMap = new Map(data.tiles.map(t => [`${t.x},${t.z}`, t.type]));
  const portalMap   = new Map(
    data.tiles.filter(t => t.type === 'portal' && t.target)
              .map(t => [`${t.x},${t.z}`, t.target])
  );

  const s = data.start_state;
  let cur = {
    x: s.pos.x, z: s.pos.z,
    o: s.orientation === 'vertical' ? 'V' : s.orientation === 'horizontal-x' ? 'HX' : 'HZ',
  };

  let precision_moves    = 0;  // HX/HZ landing on a fragile tile (must approach horizontally)
  let crumbling_moves    = 0;  // any step landing on a crumbling tile (irreversible)
  let orientation_changes = 0; // number of times orientation changes during solution
  let portal_traversals  = 0;  // portal jumps in solution
  let prevO = cur.o;

  for (const dir of data.solution_data) {
    const next = rollForward(cur, dir);

    if (next.o !== prevO) orientation_changes++;
    prevO = next.o;

    let hasFragile = false, hasCrumbling = false;
    for (const [x, z] of cellsOf(next)) {
      const k = `${x},${z}`;
      const type = tileTypeMap.get(k);
      if (type === 'fragile' && (next.o === 'HX' || next.o === 'HZ')) hasFragile = true;
      if (type === 'crumbling') { hasCrumbling = true; tileTypeMap.delete(k); }
    }
    if (hasFragile)   precision_moves++;
    if (hasCrumbling) crumbling_moves++;

    if (next.o === 'V' && portalMap.has(`${next.x},${next.z}`)) {
      portal_traversals++;
      const tg = portalMap.get(`${next.x},${next.z}`);
      cur = { x: tg.x, z: tg.z, o: 'V' };
    } else {
      cur = next;
    }
  }

  const steps = data.solution_data.length;

  let critical_hazard_count = 0;
  if (criticalTiles != null) {
    for (const tile of data.tiles) {
      if ((tile.type === 'fragile' || tile.type === 'crumbling' || tile.type === 'moving') &&
          criticalTiles.has(`${tile.x},${tile.z}`)) {
        critical_hazard_count++;
      }
    }
  }

  // Weighted behavioral metrics — max raw = 10.0
  // Path length is the dominant factor (4 pts): few tiles + few traps + many steps = hard puzzle.
  // Trap interactions are secondary: normalised to the ≤3 cap so even 1 trap registers.
  const precisionPts      = Math.min(precision_moves     / 3, 1) * 2.0;
  const crumblingPts      = Math.min(crumbling_moves     / 2, 1) * 1.0;
  const orientationPts    = Math.min(orientation_changes / 20, 1) * 1.5;
  const pathLengthPts     = Math.min(steps               / 40, 1) * 4.0;
  const portalPts         = Math.min(portal_traversals   /  3, 1) * 1.0;
  const criticalHazardPts = Math.min(critical_hazard_count / 3, 1) * 0.5;

  const raw = precisionPts + crumblingPts + orientationPts + pathLengthPts + portalPts + criticalHazardPts;
  const behavioral_difficulty = Math.max(1, Math.min(10, +raw.toFixed(2)));

  return {
    precision_moves,
    crumbling_moves,
    orientation_changes,
    portal_traversals,
    critical_hazard_count,
    behavioral_difficulty,
  };
}

// ---- Difficulty score from actual level content ---------------------
// Returns a float in [1, 10] based on behavioral metrics (not tile counts).
// criticalTiles: optional Set<"x,z"> from computeCriticalTiles() — improves accuracy.
export function computeDifficultyScore(data, criticalTiles = null) {
  return computeBehavioralMetrics(data, criticalTiles).behavioral_difficulty;
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

// ---- Evolution fitness metric ----------------------------------------
// Selection criterion for Proposal 2 (Generational Evolution).
//
// Philosophy: a puzzle is "good" when it forces many moves on few tiles
// with few traps — but every trap is unavoidable (on every shortest path).
//
//   moveEfficiency   = moves / static_tile_count      → long solution, small board
//   trapNecessity    = critical_traps / total_traps   → all traps matter
//   trapSparsity     = 1 / (1 + trap_count)           → fewer traps = each one is harder
//   orientationDensity = orientation_changes / moves  → complex navigation
//
// Accepts pre-computed criticalTiles / metrics to avoid redundant BFS calls.
export function computeEvolutionFitness(data, criticalTiles = null, preMetrics = null) {
  const moves = data.solution_data.length;
  const ct    = criticalTiles ?? computeCriticalTiles(data);
  const m     = preMetrics    ?? computeBehavioralMetrics(data, ct);

  const trapTypes   = new Set(['fragile', 'crumbling', 'moving']);
  const staticCount = data.tiles.filter(t => t.type !== 'moving').length;
  const trapCount   = data.tiles.filter(t => trapTypes.has(t.type)).length;

  const moveEfficiency     = moves / Math.max(1, staticCount);
  const trapSparsity       = 1 / Math.max(1, trapCount);
  const critTrapCount      = data.tiles.filter(t =>
    trapTypes.has(t.type) && ct.has(`${t.x},${t.z}`)
  ).length;
  const trapNecessity      = trapCount === 0 ? 1 : critTrapCount / trapCount;
  const orientationDensity = m.orientation_changes / Math.max(1, moves);

  return +(
    moveEfficiency     * 4.0
  + trapSparsity       * 2.0
  + trapNecessity      * 2.5
  + orientationDensity * 1.5
  ).toFixed(4);
}

export { makeRNG, rollForward, rollReverse, cellsOf, stateKey, generateGoldenPath, injectHazards };
